"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { pageOfWord, usePagedText } from "@/hooks/use-paged-text";
import { useSettings, useToast } from "@/components/providers";
import { useOffline } from "@/components/offline-provider";
import { NEEDS_NETWORK } from "@/lib/offline";
import { Alert, Button, Card, Segmented, Sheet, Slider, Spinner } from "@/components/ui";
import {
  BackIcon,
  CheckIcon,
  CloseIcon,
  FastForwardIcon,
  MarkIcon,
  PauseIcon,
  PlayIcon,
  ForwardIcon,
  RestartIcon,
  RewindIcon,
  SearchIcon,
  SettingsIcon,
  SparkIcon,
  VoiceIcon,
} from "@/components/icons";
import {
  chunkDurationMs,
  chunkLength,
  clamp,
  typographyVars,
  warmupFactor,
  windowStart,
  WARMUP_WORDS,
  formatClock,
  formatNumber,
  MAX_CHUNK,
  MAX_WPM,
  MIN_CHUNK,
  MIN_WPM,
  orpIndex,
  parseParagraphs,
  sliceParagraphs,
  splitEmphasis,
  startsParagraph,
  type Paragraph,
  type ReadingMode,
} from "@/lib/reading";
import { STYLE, styleClass } from "@/lib/markdown";
import { apiSend } from "@/lib/client";
import { QuizSheet } from "@/components/quiz-sheet";
import { NavigateSheet } from "@/components/navigate-sheet";
import {
  EYE_REST_AFTER_MS,
  EYE_REST_RESET_MS,
  EYE_REST_SECONDS,
  paragraphPauseMs,
  resumeTarget,
  sentenceBackTarget,
} from "@/lib/navigation";
import { HighlightSheet } from "@/components/highlight-sheet";
import { WordSheet } from "@/components/word-sheet";
import { MIN_WORDS_FOR_QUIZ } from "@/lib/quiz";
import { useWordSelection } from "@/hooks/use-word-selection";
import { useWordTouch } from "@/hooks/use-word-touch";
import { useSpeech } from "@/hooks/use-speech";
import { rateNotice } from "@/lib/speech";
import { normalizeWord, trimContext } from "@/lib/dictionary";
import {
  markCovering,
  segmentsOf,
  sentenceRange,
  type Span,
  type StoredHighlight,
} from "@/lib/highlights";
import type { ContinuationResult, HighlightItem, NextUp, TextDetail } from "@/lib/types";
import {
  checkpointCrossed,
  chunkFactor,
  highlightsBefore,
  normalizedWeights,
  recapWindow,
  wordKeyForPace,
} from "@/lib/pacing";

export const MODE_HINTS: Record<ReadingMode, string> = {
  rsvp: "Uma palavra por vez no centro da tela, com a letra de fixacao destacada.",
  flow: "Texto corrido com rolagem, destacando o trecho atual.",
  page: "Uma tela cheia por vez, sem rolagem. Toque na metade direita para avancar e na esquerda para voltar.",
};

const MIN_WORDS_TO_RECORD = 10;
const PROGRESS_SAVE_INTERVAL_MS = 5_000;
/** Salto de "uma tela" nos modos que nao tem pagina medida. */
const SCREENFUL_WORDS = 110;

/** Abaixo disso, retomar nao reinicia a rampa de aquecimento. */
const SHORT_PAUSE_MS = 3000;

interface ReaderProps {
  text: TextDetail;
  highlights: HighlightItem[];
  startAt?: number;
  nextUp: NextUp | null;
  /** Fim do trecho sugerido por tempo livre (US-85). */
  stopAt?: number;
  /** Tempo previsto para o trecho sugerido. */
  plannedMs?: number;
  /** Palavras ja consultadas, que ganham tempo no modo Foco (US-88). */
  knownWords?: string[];
}

export function ReaderClient(props: ReaderProps) {
  return <Reader key={props.text.id} {...props} />;
}

function Reader({
  text: initialText,
  highlights,
  startAt,
  nextUp,
  stopAt,
  plannedMs,
  knownWords = [],
}: ReaderProps) {
  const { settings, save } = useSettings();
  const notify = useToast();
  const { online } = useOffline();

  // Em estado porque a busca da proxima parte faz o texto crescer durante a
  // leitura, sem recarregar a tela.
  const [text, setText] = useState(initialText);
  const [loadingMore, setLoadingMore] = useState(false);

  // As duas visoes do mesmo texto: a lista corrida indexa a posicao, os
  // paragrafos dao a forma na tela.
  const { words, paragraphs } = useMemo(
    () => parseParagraphs(text.content, text.format),
    [text.content, text.format]
  );
  const total = words.length;
  // Estilo de cada palavra na lista corrida, para o modo Foco. Texto simples
  // nao tem estilo e fica sem a lista.
  const wordStyles = useMemo(
    () =>
      paragraphs.some((paragraph) => paragraph.styles)
        ? paragraphs.flatMap((paragraph) => paragraph.styles ?? paragraph.words.map(() => 0))
        : null,
    [paragraphs]
  );

  // Ritmo adaptativo (US-87, US-88): o peso de cada palavra, normalizado para
  // a media do texto continuar na velocidade escolhida. Desligado, todo bloco
  // dura o mesmo.
  const adaptive = settings.adaptiveRhythm;
  const weights = useMemo(() => {
    if (!adaptive) return null;
    const known = new Set(knownWords.map(wordKeyForPace));
    return normalizedWeights(words, known);
  }, [adaptive, words, knownWords]);

  // `startAt` vem da lista de destaques: abrir um destaque posiciona a
  // leitura nele, em vez de onde a leitura tinha parado.
  const [index, setIndex] = useState(() =>
    clamp(startAt ?? text.progressIndex, 0, Math.max(0, total - 1))
  );
  const [playing, setPlaying] = useState(false);
  // Posicao em que a leitura corrente comecou: a rampa de aquecimento conta a
  // partir dela, nao do inicio do texto - senao retomar no meio ja chegaria
  // acelerado, que e justamente o que a rampa evita.
  const warmupOriginRef = useRef(0);
  // Quando a leitura parou. Uma pausa curta nao reinicia a rampa: tirar o dedo
  // da tela por um segundo nao desfaz a adaptacao ao ritmo.
  const pausedAtRef = useRef(0);
  const [showSettings, setShowSettings] = useState(false);
  const [finished, setFinished] = useState(false);

  // Recapitulacao ao retomar um texto parado (US-77). Decidida uma vez, na
  // abertura: e o intervalo desde a ultima leitura que conta, nao o de agora.
  const [recap, setRecap] = useState<{ from: number; to: number } | null>(() =>
    recapWindow(
      words,
      text.progressIndex,
      text.lastReadAt ? new Date(text.lastReadAt) : null,
      new Date(),
      startAt !== undefined
    )
  );
  const [recapPlaying, setRecapPlaying] = useState(false);

  const wpm = settings.baseWpm;
  const chunkSize = settings.wordsPerChunk;
  const mode = settings.readingMode;
  const warmup = settings.warmup;

  useWakeLock(playing);

  // As referencias so sao preenchidas quando o modo Paginas esta montado; nos
  // outros modos o observer nunca liga e `pages` fica no valor inicial.
  const emphasis = settings.wordEmphasis;
  const { frameRef, rulerRef, pages, ready: pagesReady } = usePagedText(
    paragraphs,
    total,
    emphasis
  );
  const currentPage = pageOfWord(pages, index);
  const pageStart = pages[currentPage] ?? 0;
  const pageEnd = pages[currentPage + 1] ?? total;

  /* --- contabilidade da sessao ------------------------------------------ */
  // Refs em vez de estado: o cronometro nao precisa re-renderizar a cada tick.
  const startedAtRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const wordsReadRef = useRef(0);
  const savedIndexRef = useRef(index);
  const [displayMs, setDisplayMs] = useState(0);
  const [summary, setSummary] = useState<{ durationMs: number; wordsRead: number } | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [comprehension, setComprehension] = useState<number | null>(null);

  /* --- destaques --------------------------------------------------------- */
  const [marks, setMarks] = useState<HighlightItem[]>(highlights);
  const [openMark, setOpenMark] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  // Selecionar texto so faz sentido onde o texto esta na tela; no modo Foco a
  // unidade que da para apontar sem parar a leitura e a frase.
  const selectable = mode !== "rsvp" && !finished;
  const { span: selection, clear: clearSelection } = useWordSelection(selectable);

  const stored: StoredHighlight[] = useMemo(
    () => marks.map(({ id, start, end, note }) => ({ id, start, end, note })),
    [marks]
  );

  const createMark = useCallback(
    async (range: Span) => {
      setMarking(true);
      try {
        const data = await apiSend<{ highlights: HighlightItem[] }>(
          `/api/texts/${text.id}/destaques`,
          "POST",
          range
        );
        setMarks(data.highlights);
        notify("Trecho destacado.", "success");
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : "Nao consegui destacar.", "error");
      } finally {
        setMarking(false);
        clearSelection();
      }
    },
    [text.id, notify, clearSelection]
  );

  const saveNote = useCallback(
    async (markId: string, note: string) => {
      await apiSend(`/api/texts/${text.id}/destaques/${markId}`, "PATCH", { note });
      const trimmed = note.trim();
      setMarks((current) =>
        current.map((item) =>
          item.id === markId ? { ...item, note: trimmed.length > 0 ? trimmed : null } : item
        )
      );
    },
    [text.id]
  );

  const removeMark = useCallback(
    async (markId: string) => {
      await apiSend(`/api/texts/${text.id}/destaques/${markId}`, "DELETE");
      setMarks((current) => current.filter((item) => item.id !== markId));
    },
    [text.id]
  );

  /* --- proxima leitura --------------------------------------------------- */
  const [loadingNext, setLoadingNext] = useState(false);
  const router = useRouter();

  /**
   * Abre o proximo capitulo ou o proximo da fila.
   *
   * Quando o capitulo seguinte ainda nao esta na biblioteca, a rota o importa
   * da origem. Fim de serie nao e erro: a mensagem aparece e a tela de
   * conclusao continua no lugar.
   */
  const openNext = useCallback(async () => {
    if (!nextUp) return;

    if (nextUp.textId) {
      router.push(`/leitor/${nextUp.textId}`);
      return;
    }

    if (!online) {
      notify(NEEDS_NETWORK, "error");
      return;
    }

    setLoadingNext(true);
    try {
      const result = await apiSend<{ status: string; id?: string; message?: string }>(
        `/api/texts/${text.id}/proximo`,
        "POST"
      );

      if (result.id) router.push(`/leitor/${result.id}`);
      else notify(result.message ?? "Esta e a ultima parte da serie.", "info");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Sem conexao para buscar.", "error");
    } finally {
      setLoadingNext(false);
    }
  }, [nextUp, text.id, online, router, notify]);

  /* --- dicionario -------------------------------------------------------- */
  // Toque longo so nos modos em que o texto esta na tela; no Foco a palavra e
  // uma so e o toque dela e o de pausar.
  const word = useWordTouch(mode !== "rsvp" && !finished);
  /** Destaca a frase que contem a palavra atual, sem parar a leitura. */
  const markSentence = useCallback(() => {
    const range = sentenceRange(words, index);
    if (range) void createMark(range);
  }, [words, index, createMark]);

  // Pausas que o proprio leitor faz na troca de paragrafo (US-94). Descontadas
  // do tempo da sessao: sem isso, ligar a pausa baixaria o ritmo medido e as
  // estimativas de tempo (US-83) passariam a errar para mais.
  const pauseCreditRef = useRef(0);
  const elapsedMs = useCallback(
    () =>
      Math.max(
        0,
        elapsedRef.current +
          (startedAtRef.current ? Date.now() - startedAtRef.current : 0) -
          pauseCreditRef.current
      ),
    []
  );

  const saveProgress = useCallback(
    (position: number, useKeepalive = false) => {
      if (position === savedIndexRef.current) return;
      savedIndexRef.current = position;
      void fetch(`/api/texts/${text.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // A hora do aparelho acompanha a posicao: o que ficou na fila offline
        // pode chegar depois de outro aparelho ja ter gravado aqui.
        body: JSON.stringify({ progressIndex: position, at: new Date().toISOString() }),
        keepalive: useKeepalive,
      }).catch(() => undefined);
    },
    [text.id]
  );

  /**
   * Tempo previsto do trecho sugerido (US-85). Vai so na primeira sessao
   * gravada: a que cobre o trecho; o que se le depois dele nao foi previsto.
   */
  const plannedRef = useRef(plannedMs);

  /** Grava a sessao e zera os acumuladores. Devolve o que foi contabilizado. */
  const flushSession = useCallback(
    (completed: boolean, useKeepalive = false, narrated = false) => {
      const duration = elapsedMs();
      const wordsRead = wordsReadRef.current;

      elapsedRef.current = 0;
      startedAtRef.current = null;
      wordsReadRef.current = 0;
      pauseCreditRef.current = 0;

      if (wordsRead < MIN_WORDS_TO_RECORD || duration < 1000) {
        return { durationMs: duration, wordsRead };
      }

      const planned = plannedRef.current;
      plannedRef.current = undefined;

      void fetch("/api/reading-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          textId: text.id,
          wordsRead,
          durationMs: duration,
          completed,
          narrated,
          plannedMs: planned,
        }),
        keepalive: useKeepalive,
      }).catch(() => undefined);

      return { durationMs: duration, wordsRead };
    },
    [text.id, elapsedMs]
  );

  /* --- paradas no meio da leitura ---------------------------------------- */
  // Fim do trecho sugerido por tempo livre (US-85) e "isso ainda vale?"
  // (US-80). As duas pausam a leitura e abrem uma folha.
  const initialWpmRef = useRef(wpm);
  const stopReachedRef = useRef(false);
  const [stopInfo, setStopInfo] = useState<{ realMs: number; speedChanged: boolean } | null>(
    null
  );
  const answeredRef = useRef(text.checkpointAnswered);
  const [checkpoint, setCheckpoint] = useState<number | null>(null);
  const askCheckpoints = settings.askCheckpoints && !text.abandoned;
  const paragraphPause = settings.paragraphPause;
  const resumeRewind = settings.resumeRewind;
  const eyeRest = settings.eyeRest;
  // Posicao em que a leitura parou: o recuo ao retomar (US-95) so vale se o
  // leitor nao escolheu outra posicao durante a pausa.
  const pausedIndexRef = useRef(-1);

  /* --- motor de avanco --------------------------------------------------- */
  useEffect(() => {
    if (!playing) return;

    // Ja no fim: nada a agendar. A conclusao e tratada no callback abaixo.
    if (index >= total) return;

    // No modo Paginas o passo e a pagina inteira: o tempo de permanencia
    // corresponde as palavras que ainda faltam nela.
    // O bloco para no fim do paragrafo: o seguinte sempre abre uma tela nova.
    const step =
      mode === "page" ? Math.max(1, pageEnd - index) : chunkLength(paragraphs, index, chunkSize);
    const chunk = words.slice(index, index + step);

    // A rampa vale para o ritmo palavra a palavra. No modo Paginas a tela
    // inteira ja da tempo de sobra para o olho se ajustar.
    const factor =
      warmup && mode !== "page" ? warmupFactor(index - warmupOriginRef.current) : 1;

    // A versao anterior dividia a duracao pelo tamanho do bloco em vez de
    // multiplicar: em 350 ppm com 4 palavras o texto passava a ~5600 ppm.
    // Pausa curta antes de um paragrafo novo no modo Foco (US-94).
    const extra =
      paragraphPause && mode === "rsvp" && index + step < total && startsParagraph(paragraphs, index + step)
        ? paragraphPauseMs(wpm)
        : 0;

    const delay =
      (mode === "page"
        ? (60_000 / wpm) * step
        : chunkDurationMs(wpm, step, factor) *
          (weights ? chunkFactor(weights, index, chunk.length) : 1)) + extra;

    const timer = setTimeout(() => {
      pauseCreditRef.current += extra;
      wordsReadRef.current += Math.min(step, total - index);
      const next = index + step;

      if (next >= total) {
        setIndex(total);
        setPlaying(false);
        setFinished(true);
        saveProgress(total);
        // Guarda os numeros antes do flush zerar os acumuladores: a tela final
        // mostra a sessao que acabou de terminar.
        setSummary(flushSession(true));
      } else {
        setIndex(next);

        if (stopAt !== undefined && !stopReachedRef.current && next >= stopAt) {
          // O real e o tempo lido desde a abertura, antes de o flush zera-lo.
          stopReachedRef.current = true;
          const realMs = elapsedMs();
          pausedAtRef.current = Date.now();
          pausedIndexRef.current = next;
          setPlaying(false);
          saveProgress(next);
          flushSession(false);
          setStopInfo({ realMs, speedChanged: wpm !== initialWpmRef.current });
          return;
        }

        const marker = askCheckpoints
          ? checkpointCrossed(next, total, answeredRef.current)
          : null;
        if (marker !== null) {
          elapsedRef.current += startedAtRef.current ? Date.now() - startedAtRef.current : 0;
          startedAtRef.current = null;
          pausedAtRef.current = Date.now();
          pausedIndexRef.current = next;
          setPlaying(false);
          saveProgress(next);
          setCheckpoint(marker);
        }
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [
    playing,
    index,
    chunkSize,
    wpm,
    total,
    words,
    paragraphs,
    mode,
    pageEnd,
    warmup,
    weights,
    stopAt,
    askCheckpoints,
    paragraphPause,
    elapsedMs,
    saveProgress,
    flushSession,
  ]);

  /* --- cronometro visivel ------------------------------------------------ */
  useEffect(() => {
    if (!playing) {
      setDisplayMs(elapsedRef.current);
      return;
    }
    setDisplayMs(elapsedMs());
    const timer = setInterval(() => setDisplayMs(elapsedMs()), 500);
    return () => clearInterval(timer);
  }, [playing, elapsedMs]);

  /* --- persistencia ------------------------------------------------------ */
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => saveProgress(index), PROGRESS_SAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing, index, saveProgress]);

  // Espelho do estado atual para os handlers que rodam fora do ciclo de
  // render (visibilitychange, teclado, unmount).
  const stateRef = useRef({ index, playing, total, textId: text.id });

  useEffect(() => {
    stateRef.current = { index, playing, total, textId: text.id };
  }, [index, playing, total, text.id]);

  // Fechar a aba no meio da leitura nao pode perder a posicao nem a sessao.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      saveProgress(stateRef.current.index, true);
      if (stateRef.current.playing) flushSession(false, true);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      saveProgress(stateRef.current.index, true);
      flushSession(false, true);
    };
  }, [saveProgress, flushSession]);

  /* --- acoes ------------------------------------------------------------- */
  // Descanso da vista (US-104): tempo de leitura continua desde a ultima
  // parada longa. Parar por menos de 2 minutos nao conta como descanso.
  const restAccumRef = useRef(0);
  const restStartRef = useRef<number | null>(null);
  const [resting, setResting] = useState(false);

  const togglePlay = useCallback(() => {
    const now = Date.now();
    if (stateRef.current.playing) {
      elapsedRef.current += startedAtRef.current ? now - startedAtRef.current : 0;
      startedAtRef.current = null;
      pausedAtRef.current = now;
      pausedIndexRef.current = stateRef.current.index;
      if (restStartRef.current !== null) restAccumRef.current += now - restStartRef.current;
      restStartRef.current = null;
      saveProgress(stateRef.current.index);
      setPlaying(false);
      return;
    }

    if (stateRef.current.index >= total) return;

    const pausedMs = pausedAtRef.current > 0 ? now - pausedAtRef.current : 0;

    // Recua algumas palavras depois de uma pausa longa (US-95), desde que a
    // posicao seja a mesma em que a leitura parou.
    let from = stateRef.current.index;
    if (resumeRewind && pausedIndexRef.current === from) {
      const target = resumeTarget(words, from, pausedMs);
      if (target !== from) {
        from = target;
        stateRef.current.index = target;
        setIndex(target);
      }
    }
    pausedIndexRef.current = -1;

    // Pausa curta nao reinicia a rampa. O numero e o que separa "parei para
    // ajustar a tela" de "voltei ao texto depois de um tempo".
    const brief = now - pausedAtRef.current < SHORT_PAUSE_MS;
    if (!brief) warmupOriginRef.current = from;

    if (pausedAtRef.current === 0 || pausedMs >= EYE_REST_RESET_MS) restAccumRef.current = 0;
    restStartRef.current = now;

    startedAtRef.current = now;
    setFinished(false);
    setPlaying(true);
  }, [total, saveProgress, resumeRewind, words]);

  // Aviso de descanso: agenda para quando a leitura continua completar o
  // intervalo; pausar desarma, e o tempo ja lido fica acumulado.
  useEffect(() => {
    if (!playing || !eyeRest) return;
    const running = restStartRef.current !== null ? Date.now() - restStartRef.current : 0;
    const remaining = Math.max(0, EYE_REST_AFTER_MS - restAccumRef.current - running);
    const timer = setTimeout(() => {
      if (!stateRef.current.playing) return;
      togglePlay();
      setResting(true);
    }, remaining);
    return () => clearTimeout(timer);
  }, [playing, eyeRest, togglePlay]);

  // Consultar uma palavra pausa a leitura, e fechar o painel nao a retoma
  // sozinha: quem parou para entender uma palavra decide quando voltar.
  const wordOpen = word.touched !== null;

  useEffect(() => {
    if (wordOpen && stateRef.current.playing) togglePlay();
  }, [wordOpen, togglePlay]);

  /* --- voz alta ---------------------------------------------------------- */
  // A voz e a do idioma do texto, nao a da interface (US-68).
  const speech = useSpeech(text.language);
  const narratingRef = useRef(false);

  /**
   * Liga e desliga a narracao.
   *
   * A fala conduz a posicao: o avanco automatico fica parado enquanto ela
   * dura, senao dois relogios disputariam o mesmo indice. Pausar, avancar e
   * voltar continuam valendo - a narracao recomeca da posicao nova.
   */
  const toggleSpeech = useCallback(() => {
    if (speech.state === "falando") {
      speech.stop();
      narratingRef.current = false;
      elapsedRef.current += startedAtRef.current ? Date.now() - startedAtRef.current : 0;
      startedAtRef.current = null;
      saveProgress(stateRef.current.index);
      return;
    }

    if (stateRef.current.index >= total) return;
    if (stateRef.current.playing) togglePlay();

    // A contagem anda pela posicao anterior da propria narracao, nao pelo
    // espelho de estado: ele so e atualizado por um efeito, e entre dois
    // renders chegam dezenas de eventos de palavra - somar contra um indice
    // defasado contava a mesma leitura varias vezes.
    let narratedFrom = stateRef.current.index;

    const began = speech.start({
      from: narratedFrom,
      wpm,
      words,
      onWord: (position) => {
        wordsReadRef.current += Math.max(0, position - narratedFrom);
        narratedFrom = position;
        setIndex(position);
      },
      onEnd: () => {
        narratingRef.current = false;
        wordsReadRef.current += Math.max(0, total - narratedFrom);
        setIndex(total);
        setFinished(true);
        saveProgress(total);
        setSummary(flushSession(true, false, true));
      },
    });

    if (began) {
      narratingRef.current = true;
      startedAtRef.current = Date.now();
      setFinished(false);
      const notice = rateNotice(wpm);
      if (notice) notify(notice, "info");
    }
  }, [speech, total, wpm, words, togglePlay, saveProgress, flushSession, notify]);

  /**
   * Consulta a palavra que esta na tela no modo Foco.
   *
   * Ali nao ha o que tocar longamente: a palavra e uma so, e a frase em volta
   * vem das palavras vizinhas em vez da posicao do dedo.
   */
  const lookupCurrent = useCallback(() => {
    const current = normalizeWord(words[index]);
    if (!current) {
      togglePlay();
      return;
    }
    const around = words.slice(Math.max(0, index - 12), index + 12).join(" ");
    word.open({ word: current, context: trimContext(around) });
  }, [words, index, word, togglePlay]);

  const jump = useCallback(
    (delta: number) => {
      setIndex((current) => clamp(current + delta, 0, Math.max(0, total - 1)));
      setFinished(false);
    },
    [total]
  );

  /**
   * Busca a continuacao do conto na origem: a URL importada com ?page= da
   * proxima parte. A rota devolve 200 tambem quando nao ha mais paginas ou a
   * origem falha, entao aqui so resta tratar queda de rede - a leitura nunca
   * quebra por causa desta chamada.
   */
  const continueFromSource = useCallback(async (): Promise<boolean> => {
    if (loadingMore) return false;
    // Buscar a proxima parte depende de alcancar a origem: sem rede nao ha
    // como, e fingir que da deixaria a tela esperando para sempre.
    if (!online) {
      notify(NEEDS_NETWORK, "error");
      return false;
    }
    setLoadingMore(true);

    try {
      const result = await apiSend<ContinuationResult>(
        `/api/texts/${stateRef.current.textId}/continuar`,
        "POST"
      );

      if (result.status === "appended" && result.text) {
        const resumeAt = stateRef.current.total;
        setText(result.text);
        setFinished(false);
        setIndex(resumeAt);
        notify(
          `Parte ${result.page} carregada: mais ${formatNumber(result.addedWords ?? 0)} palavras.`,
          "success"
        );
        return true;
      }

      notify(
        result.message ?? "Nao ha mais partes neste texto.",
        result.status === "unavailable" ? "error" : "info"
      );
      return false;
    } catch {
      notify("Sem conexao para buscar a proxima parte.", "error");
      return false;
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, online, notify]);

  /** Vira a pagina no modo Paginas; nos outros, anda uma tela de texto. */
  const turnPage = useCallback(
    (direction: 1 | -1) => {
      if (mode !== "page") {
        setFinished(false);
        setIndex((current) => clamp(current + direction * SCREENFUL_WORDS, 0, Math.max(0, total - 1)));
        return;
      }

      const page = pageOfWord(pages, stateRef.current.index);
      const target = pages[page + direction];

      if (target === undefined) {
        // Fim do que ja foi importado: tenta trazer a proxima parte da origem.
        if (direction === 1) void continueFromSource();
        else setIndex(0);
        return;
      }

      setFinished(false);
      setIndex(target);
    },
    [mode, pages, total, continueFromSource]
  );

  /** Volta ao inicio da frase, ou da anterior quando ja esta no inicio (US-91). */
  const backSentence = useCallback(() => {
    setIndex(sentenceBackTarget(words, stateRef.current.index));
    setFinished(false);
  }, [words]);

  /** Vai para uma posicao escolhida na navegacao, com a leitura pausada. */
  const goTo = useCallback(
    (position: number) => {
      if (stateRef.current.playing) togglePlay();
      setIndex(clamp(position, 0, Math.max(0, total - 1)));
      setFinished(false);
    },
    [togglePlay, total]
  );

  const [navigating, setNavigating] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const restart = useCallback(() => {
    setPlaying(false);
    setFinished(false);
    setSummary(null);
    setIndex(0);
    saveProgress(0);
  }, [saveProgress]);

  /* --- recapitulacao, desistencia e parada prevista ------------------------ */
  const recapMarks = useMemo(
    () =>
      highlightsBefore(marks, text.progressIndex).map((mark) => ({
        text: words.slice(mark.start, mark.end).join(" "),
        note: mark.note,
      })),
    [marks, text.progressIndex, words]
  );

  /** Fim da recapitulacao: segue da posicao salva, sem a rampa de inicio. */
  const endRecap = useCallback(
    (continueReading: boolean) => {
      setRecap(null);
      setRecapPlaying(false);
      if (!continueReading) return;
      pausedAtRef.current = Date.now();
      warmupOriginRef.current = stateRef.current.index - WARMUP_WORDS;
      togglePlay();
    },
    [togglePlay]
  );

  const [abandoning, setAbandoning] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const concluded = text.wordCount > 0 && text.progressIndex >= text.wordCount;

  /** Larga o texto (US-79): sai da biblioteca e da fila, volta a lista. */
  const abandon = useCallback(async () => {
    setAbandoning(true);
    saveProgress(stateRef.current.index);
    try {
      await apiSend(`/api/texts/${text.id}/largar`, "POST");
      notify("Texto largado. Ele fica no filtro Largados da biblioteca.", "success");
      router.push("/textos");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Nao consegui largar.", "error");
      setAbandoning(false);
    }
  }, [text.id, saveProgress, notify, router]);

  const [resumed, setResumed] = useState(false);
  const resume = useCallback(async () => {
    try {
      await apiSend(`/api/texts/${text.id}/largar`, "DELETE");
      setResumed(true);
      notify("Texto de volta a biblioteca.", "success");
    } catch {
      notify("Nao consegui retomar.", "error");
    }
  }, [text.id, notify]);

  /** "Continuar" num marco: grava para nao perguntar de novo e retoma. */
  const keepReading = useCallback(() => {
    const marker = checkpoint;
    setCheckpoint(null);
    if (marker === null) return;
    answeredRef.current = Math.max(answeredRef.current, marker);
    void apiSend(`/api/texts/${text.id}/marco`, "POST", { marker }).catch(() => undefined);
    togglePlay();
  }, [checkpoint, text.id, togglePlay]);

  /* --- teclado (desktop) -------------------------------------------------- */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      // Com uma folha aberta, as teclas sao dela (Esc fecha, Tab navega).
      if (document.body.dataset.sheet) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft" && event.shiftKey) {
        event.preventDefault();
        backSentence();
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        // Velocidade pelo teclado (US-93), nos mesmos limites do controle.
        event.preventDefault();
        const next = clamp(wpm + (event.key === "ArrowUp" ? 25 : -25), MIN_WPM, MAX_WPM);
        if (next !== wpm) void save({ baseWpm: next });
      } else if (event.key === "1" || event.key === "2" || event.key === "3") {
        const modes: ReadingMode[] = ["rsvp", "flow", "page"];
        void save({ readingMode: modes[Number(event.key) - 1]! });
      } else if (event.key === "?") {
        setShortcutsOpen(true);
      } else if (event.key === "/") {
        event.preventDefault();
        setNavigating(true);
      } else if (event.key === "ArrowLeft") {
        turnPage(-1);
      } else if (event.key === "ArrowRight") {
        turnPage(1);
      } else if (event.key === "PageUp") {
        event.preventDefault();
        turnPage(-1);
      } else if (event.key === "PageDown") {
        event.preventDefault();
        turnPage(1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlay, turnPage, backSentence, wpm, save]);

  const progress = total > 0 ? Math.min(100, (index / total) * 100) : 0;
  const chunk = words.slice(index, index + chunkLength(paragraphs, index, chunkSize));
  // A primeira palavra do texto nao precisa de aviso: nao ha paragrafo antes.
  const paragraphStart = index > 0 && startsParagraph(paragraphs, index);

  if (total === 0) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Texto vazio</h1>
        <p className="text-muted">Nao ha palavras para ler neste registro.</p>
        <Link href="/textos" className="font-medium text-accent">
          Voltar para a biblioteca
        </Link>
      </div>
    );
  }

  return (
    <div
      className="min-h-dvh flex flex-col bg-bg"
      // A intensidade do destaque desce por variavel CSS: quem pinta o trecho
      // atual e uma regra de estilo, nao o React, entao mudar o ajuste nao
      // rerrenderiza palavra nenhuma.
      style={
        {
          "--highlight-opacity": settings.highlightOpacity,
          ...typographyVars(settings),
        } as React.CSSProperties
      }
    >
      <header className="pt-safe sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-2 py-2">
          <Link
            href="/textos"
            aria-label="Voltar"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
          >
            <BackIcon className="size-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{text.title}</p>
            <p className="tabular text-xs text-muted">
              {formatNumber(Math.min(index + 1, total))} / {formatNumber(total)} &middot;{" "}
              {formatClock(displayMs)}
            </p>
          </div>
          {/* So aparece quando ha o que revisar: um atalho para uma lista
              vazia seria ruido em uma barra ja estreita. */}
          {marks.length > 0 ? (
            <Link
              href={`/textos/${text.id}/destaques`}
              aria-label={`Destaques (${marks.length})`}
              className="relative flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
            >
              <MarkIcon className="size-5" />
              <span className="tabular absolute right-1 top-1 min-w-4 rounded-full bg-mark-soft px-1 text-[0.625rem] font-medium leading-4 text-ink">
                {marks.length}
              </span>
            </Link>
          ) : null}

          <button
            type="button"
            onClick={() => setNavigating(true)}
            aria-label="Navegar no texto"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
          >
            <SearchIcon className="size-5" />
          </button>

          <button
            type="button"
            onClick={() => setShowSettings(true)}
            aria-label="Ajustes de leitura"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
          >
            <SettingsIcon className="size-5" />
          </button>
        </div>
        <div className="h-0.5 bg-surface-2">
          <div
            className="h-full bg-accent transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        {recapPlaying && recap ? (
          <RecapPlayer
            marks={recapMarks}
            words={words.slice(recap.from, recap.to)}
            wpm={wpm}
            onDone={() => endRecap(true)}
            onSkip={() => endRecap(true)}
          />
        ) : finished ? (
          <Finished
            total={total}
            durationMs={summary?.durationMs ?? 0}
            wordsRead={summary?.wordsRead ?? total}
            onRestart={restart}
            canContinue={Boolean(text.sourceUrl)}
            loadingMore={loadingMore}
            onContinue={() => void continueFromSource()}
            canQuiz={total >= MIN_WORDS_FOR_QUIZ}
            comprehension={comprehension}
            onQuiz={() => setQuizOpen(true)}
            nextUp={nextUp}
            loadingNext={loadingNext}
            onNext={() => void openNext()}
          />
        ) : mode === "rsvp" ? (
          <RsvpStage
            chunk={chunk}
            chunkStyle={wordStyles?.[index] ?? 0}
            paragraphStart={paragraphStart}
            onToggle={togglePlay}
            playing={playing}
            onLookup={lookupCurrent}
          />
        ) : mode === "page" ? (
          <PageStage
            frameRef={frameRef}
            rulerRef={rulerRef}
            paragraphs={paragraphs}
            pageStart={pageStart}
            pageEnd={pageEnd}
            ready={pagesReady}
            loadingMore={loadingMore}
            marks={stored}
            emphasis={emphasis}
            touch={word.handlers}
            onTurn={turnPage}
            onOpenMark={setOpenMark}
          />
        ) : (
          <FlowStage
            paragraphs={paragraphs}
            totalWords={total}
            index={index}
            chunkSize={chunk.length}
            marks={stored}
            emphasis={emphasis}
            dim={settings.dimLines && playing}
            touch={word.handlers}
            onToggle={togglePlay}
            onSeek={(position) => {
              setIndex(position);
              setFinished(false);
            }}
            onOpenMark={setOpenMark}
          />
        )}
      </main>

      {text.abandoned && !resumed ? (
        <div className="sticky bottom-0 z-30 px-4 pb-2">
          <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-float">
            <p className="flex-1 text-sm">Voce largou este texto. Ele esta fora da biblioteca.</p>
            <Button size="sm" onClick={() => void resume()}>
              Retomar
            </Button>
          </div>
        </div>
      ) : null}

      {recap && !recapPlaying && !playing && !finished ? (
        <div className="sticky bottom-0 z-30 px-4 pb-2">
          <div className="mx-auto max-w-3xl space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-float">
            <div>
              <p className="font-medium">Recapitular o contexto</p>
              <p className="text-sm text-muted">
                Faz tempo desde a ultima leitura. Reveja o trecho anterior antes de continuar.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => endRecap(false)}>
                Pular
              </Button>
              <Button onClick={() => setRecapPlaying(true)}>Recapitular</Button>
            </div>
          </div>
        </div>
      ) : null}

      {speech.error ? (
        <div className="sticky bottom-0 z-30 px-4 pb-2">
          <Alert>{speech.error}</Alert>
        </div>
      ) : null}

      {selection && !finished ? (
        <div className="pointer-events-none sticky bottom-0 z-30 flex justify-center px-4">
          <div className="pointer-events-auto mb-2 flex items-center gap-1 rounded-full border border-border bg-surface p-1 shadow-float">
            <Button size="md" loading={marking} onClick={() => void createMark(selection)}>
              <MarkIcon className="size-5" />
              Destacar
            </Button>
            <ControlButton label="Cancelar selecao" onClick={clearSelection}>
              <CloseIcon className="size-5" />
            </ControlButton>
          </div>
        </div>
      ) : null}

      {!finished && !recapPlaying ? (
        <footer className="pb-safe sticky bottom-0 border-t border-border bg-bg/95 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl px-4 py-3">
            <div className="relative flex items-center justify-center gap-3">
              {mode === "page" ? (
                <ControlButton label="Pagina anterior" onClick={() => turnPage(-1)}>
                  <BackIcon className="size-5" />
                </ControlButton>
              ) : (
                <ControlButton label="Voltar 10 palavras" onClick={() => jump(-10)}>
                  <RewindIcon className="size-5" />
                </ControlButton>
              )}

              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? "Pausar" : "Iniciar leitura"}
                className="flex size-16 items-center justify-center rounded-full bg-accent text-accent-ink shadow-float transition-transform active:scale-95"
              >
                {playing ? <PauseIcon className="size-7" /> : <PlayIcon className="size-7" />}
              </button>

              {mode === "page" ? (
                <ControlButton label="Proxima pagina" onClick={() => turnPage(1)}>
                  <ForwardIcon className="size-5" />
                </ControlButton>
              ) : (
                <ControlButton label="Avancar 10 palavras" onClick={() => jump(10)}>
                  <FastForwardIcon className="size-5" />
                </ControlButton>
              )}

              {/* A narracao acompanha o texto na tela, entao so faz sentido
                  onde ele esta visivel. */}
              {mode === "flow" ? (
                <div className="absolute left-0">
                  <ControlButton
                    label={speech.state === "falando" ? "Parar a narracao" : "Ler em voz alta"}
                    onClick={toggleSpeech}
                    active={speech.state === "falando"}
                  >
                    <VoiceIcon className="size-5" />
                  </ControlButton>
                </div>
              ) : null}

              {/* No modo Foco nao ha texto na tela para selecionar: a unidade
                  que da para apontar sem parar a leitura e a frase. Fica
                  absoluto na borda para nao tirar o botao de play do centro,
                  que e onde o polegar o procura. */}
              {mode === "rsvp" ? (
                <div className="absolute right-0">
                  <ControlButton label="Destacar frase" onClick={markSentence}>
                    <MarkIcon className="size-5" />
                  </ControlButton>
                </div>
              ) : null}
            </div>

            {mode !== "page" ? (
              <div className="mt-1 flex justify-center">
                <button
                  type="button"
                  onClick={backSentence}
                  className="min-h-9 rounded-full px-3 text-sm text-muted hover:bg-surface-2 hover:text-ink"
                >
                  Voltar a frase
                </button>
              </div>
            ) : null}

            {mode === "page" && pagesReady ? (
              <p className="tabular mt-2 text-center text-sm text-muted">
                {`Pagina ${currentPage + 1} de ${pages.length}`}
              </p>
            ) : null}

            <div className="mt-2">
              <Slider
                label="Velocidade"
                display={`${wpm} ppm`}
                min={MIN_WPM}
                max={MAX_WPM}
                step={10}
                value={wpm}
                onChange={(value) => void save({ baseWpm: value })}
              />
            </div>
          </div>
        </footer>
      ) : null}

      {word.touched ? (
        <WordSheet
          key={word.touched.word}
          word={word.touched.word}
          context={word.touched.context}
          textId={text.id}
          onClose={word.clear}
        />
      ) : null}

      {openMark && marks.some((item) => item.id === openMark) ? (
        <HighlightSheet
          key={openMark}
          mark={marks.find((item) => item.id === openMark)!}
          onClose={() => setOpenMark(null)}
          onSaveNote={(note) => saveNote(openMark, note)}
          onRemove={() => removeMark(openMark)}
        />
      ) : null}

      <NavigateSheet
        open={navigating}
        onClose={() => setNavigating(false)}
        textId={text.id}
        words={words}
        paragraphs={paragraphs}
        index={index}
        onGo={goTo}
      />

      <Sheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Atalhos de teclado">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="contents">
              <dt>
                <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
                  {keys}
                </kbd>
              </dt>
              <dd className="text-muted">{action}</dd>
            </div>
          ))}
        </dl>
      </Sheet>

      <EyeRestSheet
        open={resting}
        onClose={() => {
          // O descanso zera a contagem: os proximos 20 minutos comecam agora.
          restAccumRef.current = 0;
          setResting(false);
        }}
      />

      <QuizSheet
        textId={text.id}
        open={quizOpen}
        onClose={() => setQuizOpen(false)}
        onScored={setComprehension}
      />

      <Sheet open={showSettings} onClose={() => setShowSettings(false)} title="Ajustes de leitura">
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted">Modo</p>
            <Segmented<ReadingMode>
              label="Modo de leitura"
              value={mode}
              onChange={(value) => void save({ readingMode: value })}
              options={[
                { value: "rsvp", label: "Foco" },
                { value: "flow", label: "Rolagem" },
                { value: "page", label: "Paginas" },
              ]}
            />
            <p className="text-sm text-faint">{MODE_HINTS[mode]}</p>
          </div>

          <Slider
            label="Velocidade"
            display={`${wpm} ppm`}
            min={MIN_WPM}
            max={MAX_WPM}
            step={10}
            hint="Palavras por minuto."
            value={wpm}
            onChange={(value) => void save({ baseWpm: value })}
          />

          <Slider
            label="Palavras por bloco"
            display={`${chunkSize}`}
            min={MIN_CHUNK}
            max={MAX_CHUNK}
            hint="Quantas palavras aparecem juntas a cada passo."
            value={chunkSize}
            onChange={(value) => void save({ wordsPerChunk: value })}
          />

          <Button
            variant="secondary"
            full
            onClick={() => {
              restart();
              setShowSettings(false);
              notify("Leitura reiniciada.");
            }}
          >
            <RestartIcon className="size-5" />
            Comecar do inicio
          </Button>

          <Link
            href={`/textos/${text.id}/leituras`}
            className="flex min-h-11 items-center justify-center rounded-full text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
          >
            Historico deste texto
          </Link>

          {/* Concluido nao se larga; largado ja esta fora da lista. */}
          {!concluded && !finished && !text.abandoned ? (
            <Button
              variant="ghost"
              full
              onClick={() => {
                setShowSettings(false);
                setConfirmAbandon(true);
              }}
            >
              Largar texto
            </Button>
          ) : null}
        </div>
      </Sheet>

      <Sheet
        open={confirmAbandon}
        onClose={() => setConfirmAbandon(false)}
        title="Largar este texto?"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Ele sai da biblioteca e da fila e fica no filtro Largados. O que voce ja leu continua
            contando na meta e no historico, e da para retomar depois.
          </p>
          <Button variant="danger" size="lg" full loading={abandoning} onClick={() => void abandon()}>
            Largar texto
          </Button>
        </div>
      </Sheet>

      <Sheet
        open={checkpoint !== null}
        onClose={keepReading}
        title="Isso ainda vale?"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {`Voce leu ${checkpoint ?? 0}% de "${text.title}". Se o texto deixou de interessar, largar agora economiza o resto do tempo.`}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => {
                setCheckpoint(null);
                setConfirmAbandon(true);
              }}
            >
              Largar
            </Button>
            <Button size="lg" onClick={keepReading}>
              Continuar
            </Button>
          </div>
        </div>
      </Sheet>

      <Sheet
        open={stopInfo !== null}
        onClose={() => setStopInfo(null)}
        title="Fim do trecho previsto"
      >
        {stopInfo ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-center">
              <Card className="p-3">
                <p className="tabular text-xl font-semibold">{formatClock(plannedMs ?? 0)}</p>
                <p className="text-sm text-muted">previsto</p>
              </Card>
              <Card className="p-3">
                <p className="tabular text-xl font-semibold">{formatClock(stopInfo.realMs)}</p>
                <p className="text-sm text-muted">real</p>
              </Card>
            </div>
            {stopInfo.speedChanged ? (
              <p className="text-sm text-muted">Velocidade alterada durante a leitura.</p>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Link
                href="/textos"
                className="inline-flex min-h-13 items-center justify-center rounded-full border border-border font-medium text-muted"
              >
                Parar aqui
              </Link>
              <Button
                size="lg"
                onClick={() => {
                  setStopInfo(null);
                  togglePlay();
                }}
              >
                Continuar
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const SHORTCUTS: [string, string][] = [
  ["Espaco", "Iniciar ou pausar"],
  ["Seta para cima / baixo", "Mais ou menos 25 ppm"],
  ["Seta para a esquerda / direita", "Voltar ou avancar uma tela"],
  ["Shift + seta para a esquerda", "Voltar ao inicio da frase"],
  ["1, 2, 3", "Modo Foco, Rolagem ou Paginas"],
  ["/", "Buscar e navegar no texto"],
  ["?", "Esta lista"],
  ["Esc", "Fechar a janela aberta"],
];

/**
 * Pausa para descansar a vista (US-104). A contagem regressiva nao retoma a
 * leitura sozinha: quem decide a volta e o leitor.
 */
function EyeRestSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [left, setLeft] = useState(EYE_REST_SECONDS);

  useEffect(() => {
    if (!open) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const remaining = Math.max(0, EYE_REST_SECONDS - Math.floor((Date.now() - started) / 1000));
      setLeft(remaining);
      if (remaining === 0) clearInterval(timer);
    }, 250);
    return () => {
      clearInterval(timer);
      setLeft(EYE_REST_SECONDS);
    };
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Descanso da vista">
      <div className="space-y-4 text-center">
        <p className="text-base">Olhe para longe por 20 segundos.</p>
        <p className="tabular text-4xl font-semibold" aria-live="polite">
          {left > 0 ? left : "Pronto"}
        </p>
        {left === 0 ? (
          <Button size="lg" full onClick={onClose}>
            Continuar
          </Button>
        ) : (
          <p className="text-sm text-muted">A leitura esta pausada.</p>
        )}
      </div>
    </Sheet>
  );
}

function ControlButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`flex size-12 items-center justify-center rounded-full border transition-colors active:scale-95 ${
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Modo foco: o bloco fica parado no centro e a letra do ponto otimo de
 * reconhecimento alinha com as guias, para o olho nao precisar varrer.
 */
function RsvpStage({
  chunk,
  chunkStyle,
  paragraphStart,
  playing,
  onToggle,
  onLookup,
}: {
  chunk: string[];
  /** Estilo Markdown da primeira palavra do bloco; 0 em texto simples. */
  chunkStyle: number;
  /** O bloco abre um paragrafo novo. */
  paragraphStart: boolean;
  playing: boolean;
  onToggle: () => void;
  onLookup: () => void;
}) {
  const single = chunk.length === 1 ? chunk[0] : null;

  return (
    <button
      type="button"
      // Parado, o toque na palavra consulta; correndo, ele pausa. Os dois
      // gestos nao competem porque so um existe de cada vez.
      onClick={playing ? onToggle : onLookup}
      aria-label={playing ? "Pausar" : "Consultar a palavra"}
      className="flex flex-1 flex-col items-center justify-center px-4 text-center"
    >
      <div className="relative w-full max-w-2xl">
        <div className="absolute inset-x-0 top-0 flex justify-center">
          <span className="h-3 w-px bg-accent/40" />
        </div>
        <div className="absolute inset-x-0 bottom-0 flex justify-center">
          <span className="h-3 w-px bg-accent/40" />
        </div>
        {/* Sinal de paragrafo a esquerda, fora do eixo de fixacao: aparece
            so enquanto a primeira palavra do paragrafo esta na tela. */}
        {paragraphStart ? (
          <span
            data-testid="inicio-paragrafo"
            aria-hidden="true"
            className="paragraph-sign absolute left-0 top-1/2 -translate-y-1/2 text-[clamp(1.5rem,7vw,2.5rem)]"
          >
            {"\u00b6"}
          </span>
        ) : null}

        <p
          className={`reader-word flex min-h-[4.5rem] items-center justify-center py-6 text-[clamp(2rem,11vw,4rem)] ${
            chunkStyle & (STYLE.bold | STYLE.heading) ? "font-extrabold" : "font-semibold"
          } ${styleClass(chunkStyle & ~STYLE.bold)}`}
        >
          {single ? <OrpWord word={single} /> : <span>{chunk.join(" ")}</span>}
        </p>
      </div>

      {!playing ? (
        <span className="mt-6 text-sm text-faint">Toque na palavra para consultar</span>
      ) : null}
    </button>
  );
}

/**
 * Alinha a letra de fixacao no centro exato da tela, deslocando o restante da
 * palavra ao redor dela. Precisa de um flex de largura total: em `inline-flex`
 * o container encolhe ate o conteudo, `flex-1` nao tem espaco para distribuir
 * e a letra cai em qualquer posicao - que e justamente o que o modo foco
 * existe para evitar.
 */
function OrpWord({ word }: { word: string }) {
  const pivot = orpIndex(word);
  return (
    <span className="flex w-full items-baseline">
      <span className="flex-1 whitespace-pre text-right">{word.slice(0, pivot)}</span>
      <span className="orp">{word.slice(pivot, pivot + 1)}</span>
      <span className="flex-1 whitespace-pre text-left">{word.slice(pivot + 1)}</span>
    </span>
  );
}

/**
 * Modo Paginas: uma tela cheia de texto por vez, sem rolagem.
 *
 * O frame define a altura disponivel e a regua oculta mede, com a mesma
 * largura e tipografia, quantas palavras cabem nela. Toque na metade direita
 * avanca, na esquerda volta - o mesmo gesto de um e-reader.
 */
/**
 * Uma palavra, com ou sem enfase no inicio.
 *
 * A arvore que sai daqui e a mesma que a regua de paginacao monta a mao em
 * `use-paged-text.ts`: as duas passam por `splitEmphasis`, entao o negrito
 * que muda a largura na tela tambem muda a largura medida.
 */
function Word({
  word,
  emphasis,
  style = 0,
}: {
  word: string;
  emphasis: boolean;
  /** Estilo Markdown da palavra (bits de STYLE). */
  style?: number;
}) {
  const body = emphasis ? (
    <>
      {splitEmphasis(word, true).map((part, index) =>
        part.bold ? <b key={index}>{part.text}</b> : <span key={index}>{part.text}</span>
      )}
    </>
  ) : (
    word
  );

  const classes = styleClass(style);
  return classes ? <span className={classes}>{body}</span> : <>{body}</>;
}

/** Uma sequencia de palavras, com o espaco entre elas. */
function Words({
  words,
  emphasis,
  styles,
}: {
  words: string[];
  emphasis: boolean;
  styles?: number[];
}) {
  const styled = styles?.some((style) => styleClass(style) !== "") ?? false;
  if (!emphasis && !styled) return <>{words.join(" ")}</>;

  return (
    <>
      {words.map((word, index) => (
        <span key={index}>
          {index > 0 ? " " : null}
          <Word word={word} emphasis={emphasis} style={styles?.[index]} />
        </span>
      ))}
    </>
  );
}

/**
 * Atributos do paragrafo que dizem, ao CSS, o tipo do bloco Markdown e se o
 * trecho continua um paragrafo iniciado antes (sem recuo de primeira linha).
 */
function blockProps(paragraph: Paragraph) {
  return {
    ...(paragraph.kind && paragraph.kind !== "p"
      ? { "data-kind": paragraph.kind, "data-marker": paragraph.marker }
      : {}),
    ...(paragraph.continued ? { "data-cont": "" } : {}),
  };
}

/** Os quatro manipuladores de ponteiro que o toque longo precisa. */
type WordTouchHandlers = ReturnType<typeof useWordTouch>["handlers"];

/** Posicao da palavra dentro do trecho destacado. */
function edgeOf(position: number, mark: StoredHighlight): string {
  const first = position === mark.start;
  const last = position === mark.end - 1;
  if (first && last) return "unico";
  if (first) return "inicio";
  if (last) return "fim";
  return "meio";
}

/**
 * Um paragrafo do modo Paginas, quebrado nos trechos destacados.
 *
 * Sem destaque algum sai um no de texto unico - exatamente o que a regua de
 * paginacao mede. Com destaque, os pedacos sao `<span>` em linha, sem caixa
 * propria: o fundo pintado nao muda onde as linhas quebram.
 */
function MarkedText({
  paragraph,
  marks,
  emphasis,
  onOpenMark,
}: {
  paragraph: Paragraph;
  marks: StoredHighlight[];
  emphasis: boolean;
  onOpenMark: (id: string) => void;
}) {
  const end = paragraph.start + paragraph.words.length;
  const segments = segmentsOf(paragraph.start, end, marks);

  if (segments.length === 1 && segments[0]!.id === null) {
    return (
      <span data-start={paragraph.start}>
        <Words words={paragraph.words} emphasis={emphasis} styles={paragraph.styles} />
      </span>
    );
  }

  return (
    <>
      {segments.map((segment, position) => {
        const from = segment.start - paragraph.start;
        const words = paragraph.words.slice(from, segment.end - paragraph.start);
        const styles = paragraph.styles?.slice(from, segment.end - paragraph.start);
        // O espaco entre pedacos vive fora deles: dentro, entraria na contagem
        // de palavras do pedaco seguinte e deslocaria a selecao em um.
        const gap = segment.end < end ? " " : "";

        if (!segment.id) {
          return (
            <span key={position} data-start={segment.start}>
              <Words words={words} emphasis={emphasis} styles={styles} />
              {gap}
            </span>
          );
        }

        return (
          <span key={position}>
            <span
              data-start={segment.start}
              data-note={segment.hasNote ? "sim" : undefined}
              className="mark"
              onClick={() => onOpenMark(segment.id!)}
            >
              <Words words={words} emphasis={emphasis} styles={styles} />
            </span>
            {gap}
          </span>
        );
      })}
    </>
  );
}

function PageStage({
  frameRef,
  rulerRef,
  paragraphs,
  pageStart,
  pageEnd,
  ready,
  loadingMore,
  marks,
  emphasis,
  touch,
  onTurn,
  onOpenMark,
}: {
  frameRef: React.Ref<HTMLDivElement>;
  rulerRef: React.RefObject<HTMLDivElement | null>;
  paragraphs: Paragraph[];
  pageStart: number;
  pageEnd: number;
  ready: boolean;
  loadingMore: boolean;
  marks: StoredHighlight[];
  emphasis: boolean;
  touch: WordTouchHandlers;
  onTurn: (direction: 1 | -1) => void;
  onOpenMark: (id: string) => void;
}) {
  const touchStartX = useRef<number | null>(null);

  const onTouchStart = (event: React.TouchEvent) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null) return;

    const delta = (event.changedTouches[0]?.clientX ?? start) - start;
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
    onTurn(delta < 0 ? 1 : -1);
  };

  return (
    <div
      className="relative flex flex-1 flex-col px-5 py-6"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      {...touch}
    >
      {/* A altura vem do flex, nao de height:100%: a altura do pai e definida
          por flex-grow e, para porcentagem, conta como indefinida - o frame
          media zero e nenhuma pagina era calculada. */}
      <div
        ref={frameRef}
        className="relative mx-auto min-h-0 w-full max-w-2xl flex-1 overflow-hidden"
      >
        <div className="reader-prose">
          {ready
            ? sliceParagraphs(paragraphs, pageStart, pageEnd).map((paragraph) => (
                <p key={paragraph.start} {...blockProps(paragraph)}>
                  <MarkedText
                    paragraph={paragraph}
                    marks={marks}
                    emphasis={emphasis}
                    onOpenMark={onOpenMark}
                  />
                </p>
              ))
            : null}
        </div>

        {/* Regua: fora da arvore visivel, com a mesma largura, tipografia e
            espacamento entre paragrafos da pagina acima. */}
        <div
          ref={rulerRef}
          aria-hidden="true"
          className="reader-prose pointer-events-none invisible absolute inset-x-0 top-0"
        />
      </div>

      {loadingMore ? (
        <p className="absolute inset-x-0 bottom-1 flex items-center justify-center gap-2 text-sm text-muted">
          <Spinner />
          Buscando a proxima parte
        </p>
      ) : null}

      {/* Zonas de toque: metade esquerda volta, metade direita avanca. */}
      <button
        type="button"
        aria-label="Pagina anterior"
        onClick={() => onTurn(-1)}
        className="absolute inset-y-0 left-0 w-2/5"
      />
      <button
        type="button"
        aria-label="Proxima pagina"
        onClick={() => onTurn(1)}
        className="absolute inset-y-0 right-0 w-2/5"
      />
    </div>
  );
}

const SWIPE_THRESHOLD_PX = 45;
const WINDOW_BEFORE = 80;
const WINDOW_AFTER = 220;
/** Quanto a janela da rolagem cresce ao chegar no fim do que foi renderizado. */
const WINDOW_STEP = 400;

function FlowStage({
  paragraphs,
  totalWords,
  index,
  chunkSize,
  marks,
  emphasis,
  dim,
  touch,
  onToggle,
  onSeek,
  onOpenMark,
}: {
  paragraphs: Paragraph[];
  totalWords: number;
  index: number;
  chunkSize: number;
  marks: StoredHighlight[];
  emphasis: boolean;
  /** Apagar as linhas fora da atual (US-103). */
  dim: boolean;
  touch: WordTouchHandlers;
  onToggle: () => void;
  onSeek: (position: number) => void;
  onOpenMark: (id: string) => void;
}) {
  // Renderiza so a janela ao redor da posicao atual: um artigo de 5 mil
  // palavras viraria 5 mil elementos a cada passo. A janela cresce conforme a
  // leitura chega ao fim do que ja foi renderizado - sem isso o texto
  // simplesmente acabava algumas centenas de palavras a frente e nao havia
  // como continuar lendo manualmente.
  const [reach, setReach] = useState(WINDOW_AFTER);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLSpanElement>(null);

  const start = windowStart(paragraphs, index - WINDOW_BEFORE, WINDOW_STEP);
  const end = Math.min(totalWords, index + reach);
  const visible = sliceParagraphs(paragraphs, start, end);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    // Callback de um observer: estender a janela aqui mantem a escrita de
    // estado fora do corpo do efeito.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setReach((current) => current + WINDOW_STEP);
      }
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [end]);

  // Quando a janela descarta paragrafos do topo, o texto que fica sobe na
  // pagina. A compensacao mantem a palavra atual no mesmo ponto da tela: guarda
  // a posicao dela no documento (independe da rolagem, entao uma rolagem suave
  // em andamento nao entra na conta) e rola a diferenca antes da pintura.
  const stageRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ position: number; offset: number; start: number } | null>(null);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (anchor && anchor.start !== start) {
      const element = stageRef.current?.querySelector(`[data-start="${anchor.position}"]`);
      if (element) {
        const shift = element.getBoundingClientRect().top + window.scrollY - anchor.offset;
        if (shift !== 0) window.scrollBy({ top: shift, behavior: "instant" });
      }
    }
    const active = activeRef.current;
    anchorRef.current = active
      ? { position: index, offset: active.getBoundingClientRect().top + window.scrollY, start }
      : null;
  }, [index, start]);

  // Linha atual (US-103): as palavras na mesma altura da palavra ativa ganham
  // `data-line`, e o CSS apaga as demais. Feito aqui, e nao no render, porque
  // onde a linha quebra so se sabe depois do layout.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.querySelectorAll("[data-line]").forEach((element) => element.removeAttribute("data-line"));
    const active = activeRef.current;
    if (!dim || !active) return;

    const top = active.offsetTop;
    const parent = active.offsetParent;
    stage.querySelectorAll<HTMLElement>(".flow-word").forEach((element) => {
      if (element.offsetParent === parent && Math.abs(element.offsetTop - top) < 4) {
        element.setAttribute("data-line", "");
      }
    });
  }, [dim, index, start, end]);

  // Sem isso o destaque desce para fora da tela e o leitor perde a posicao.
  // Rola apenas quando a palavra atual sai da faixa confortavel de leitura,
  // em vez de a cada passo.
  useEffect(() => {
    const element = activeRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const upper = window.innerHeight * 0.3;
    const lower = window.innerHeight * 0.62;

    if (rect.top < upper || rect.bottom > lower) {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [index]);

  return (
    <div
      ref={stageRef}
      // A compensacao acima faz o papel da ancoragem nativa; as duas juntas
      // rolariam o deslocamento duas vezes.
      style={{ overflowAnchor: "none" }}
      data-dim={dim ? "" : undefined}
      className="flex-1 px-5 py-8"
      onDoubleClick={onToggle}
      {...touch}
    >
      <div className="reader-prose mx-auto max-w-2xl">
        {visible.map((paragraph) => (
          <p key={paragraph.start} {...blockProps(paragraph)}>
            {paragraph.words.map((word, offset) => {
              const position = paragraph.start + offset;
              const state =
                position >= index && position < index + chunkSize
                  ? "active"
                  : position < index
                    ? "read"
                    : "pending";
              const mark = markCovering(marks, position);
              const last = mark ? position === mark.end - 1 : false;

              return (
                <span
                  key={position}
                  ref={position === index ? activeRef : undefined}
                  data-state={state}
                  // `data-start` e o elo entre a tela e os indices: e por ele
                  // que a selecao vira intervalo de palavras.
                  data-start={position}
                  className={`flow-word cursor-pointer${mark ? " mark" : ""}`}
                  // Onde a palavra esta dentro do trecho: so as pontas do
                  // destaque ficam arredondadas, para que ele seja lido como
                  // uma marcacao unica e nao uma por palavra.
                  data-edge={mark ? edgeOf(position, mark) : undefined}
                  data-note={mark?.note && last ? "sim" : undefined}
                  onClick={() => (mark ? onOpenMark(mark.id) : onSeek(position))}
                >
                  <Word word={word} emphasis={emphasis} style={paragraph.styles?.[offset]} />{" "}
                </span>
              );
            })}
          </p>
        ))}
      </div>

      {end < totalWords ? (
        <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      ) : null}

      <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-faint">
        {end < totalWords
          ? "Toque em uma palavra para pular ate ela."
          : "Fim do texto. Toque em uma palavra para voltar."}
      </p>
    </div>
  );
}

function Finished({
  total,
  durationMs,
  wordsRead,
  onRestart,
  canContinue,
  loadingMore,
  onContinue,
  canQuiz,
  comprehension,
  onQuiz,
  nextUp,
  loadingNext,
  onNext,
}: {
  total: number;
  durationMs: number;
  wordsRead: number;
  onRestart: () => void;
  canContinue: boolean;
  loadingMore: boolean;
  onContinue: () => void;
  canQuiz: boolean;
  comprehension: number | null;
  onQuiz: () => void;
  nextUp: NextUp | null;
  loadingNext: boolean;
  onNext: () => void;
}) {
  const minutes = durationMs / 60_000;
  const wpm = minutes > 0 ? Math.round(wordsRead / minutes) : 0;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-positive-soft text-positive">
        <CheckIcon className="size-8" />
      </div>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Leitura concluida</h2>
        <p className="mt-1 text-muted">{formatNumber(total)} palavras</p>
      </div>

      <Card
        className={`grid w-full max-w-sm divide-x divide-border ${
          comprehension === null ? "grid-cols-2" : "grid-cols-3"
        }`}
      >
        <div className="p-4">
          <p className="tabular text-2xl font-semibold">{wpm > 0 ? wpm : "--"}</p>
          <p className="text-sm text-muted">ppm</p>
        </div>
        <div className="p-4">
          <p className="tabular text-2xl font-semibold">{formatClock(durationMs)}</p>
          <p className="text-sm text-muted">tempo</p>
        </div>
        {comprehension !== null ? (
          <div className="p-4">
            <p className="tabular text-2xl font-semibold">{comprehension}%</p>
            <p className="text-sm text-muted">acertos</p>
          </div>
        ) : null}
      </Card>

      <div className="flex w-full max-w-sm flex-col gap-2">
        {/* Primeiro botao da tela: quem terminou um capitulo quer o proximo,
            nao reler o que acabou de ler. */}
        {nextUp ? (
          <Button size="lg" full loading={loadingNext} onClick={onNext}>
            <ForwardIcon className="size-5" />
            {nextUp.source === "capitulo"
              ? nextUp.textId
                ? `Capitulo ${nextUp.chapter ?? ""}`.trim()
                : `Buscar o capitulo ${nextUp.chapter ?? ""}`.trim()
              : "Proximo da fila"}
          </Button>
        ) : null}

        {nextUp?.title ? (
          <p className="-mt-1 line-clamp-1 text-sm text-muted">{nextUp.title}</p>
        ) : null}

        {canQuiz ? (
          <Button variant="secondary" size="lg" full onClick={onQuiz}>
            <SparkIcon className="size-5" />
            {comprehension === null ? "Testar compreensao" : "Ver o questionario"}
          </Button>
        ) : null}

        {canContinue ? (
          <Button
            variant={nextUp ? "secondary" : "primary"}
            size="lg"
            full
            loading={loadingMore}
            onClick={onContinue}
          >
            <ForwardIcon className="size-5" />
            {loadingMore ? "Buscando" : "Buscar proxima parte"}
          </Button>
        ) : null}

        <Button variant={canContinue ? "secondary" : "primary"} size="lg" full onClick={onRestart}>
          <RestartIcon className="size-5" />
          Ler de novo
        </Button>
        <Link
          href="/textos"
          className="inline-flex min-h-12 items-center justify-center rounded-full border border-border font-medium text-muted"
        >
          Voltar para a biblioteca
        </Link>
      </div>
    </div>
  );
}

/**
 * Recapitulacao (US-77, US-78): os destaques anteriores, cada um com a nota,
 * e depois as ultimas palavras lidas, uma por vez.
 *
 * Componente proprio de proposito: nao toca na posicao nem no cronometro do
 * leitor, entao nada do que passa aqui e gravado como progresso ou sessao.
 */
function RecapPlayer({
  marks,
  words,
  wpm,
  onDone,
  onSkip,
}: {
  marks: { text: string; note: string | null }[];
  words: string[];
  wpm: number;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState(0);
  const total = marks.length + words.length;
  const mark = step < marks.length ? marks[step] : null;
  const word = mark ? null : words[step - marks.length];

  useEffect(() => {
    if (step >= total) {
      onDone();
      return;
    }
    // Destaque fica o tempo de ser lido, com um minimo para a nota; a palavra,
    // o tempo do ritmo sem a rampa - a recapitulacao ja e o aquecimento.
    const perWord = 60_000 / Math.max(wpm, 1);
    const delay = mark
      ? Math.max(2_000, mark.text.split(/\s+/).length * perWord)
      : perWord;
    const timer = setTimeout(() => setStep((current) => current + 1), delay);
    return () => clearTimeout(timer);
  }, [step, total, mark, wpm, onDone]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <p className="text-sm font-medium text-muted">
        {mark ? "Seus destaques ate aqui" : "Onde voce parou"}
      </p>
      {mark ? (
        <div className="w-full max-w-2xl space-y-3">
          <p className="reader-prose text-left">&ldquo;{mark.text}&rdquo;</p>
          {mark.note ? <p className="text-left text-sm text-muted">{mark.note}</p> : null}
        </div>
      ) : (
        <p className="reader-word flex min-h-[4.5rem] items-center justify-center py-6 text-[clamp(2rem,11vw,4rem)] font-semibold">
          {word ? <OrpWord word={word} /> : null}
        </p>
      )}
      <Button variant="ghost" onClick={onSkip}>
        Pular a recapitulacao
      </Button>
    </div>
  );
}
