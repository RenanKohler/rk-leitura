"use client";

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { pageOfWord, usePagedText } from "@/hooks/use-paged-text";
import { useSettings, useTheme, useToast, type ThemePreference } from "@/components/providers";
import { useOffline } from "@/components/offline-provider";
import { NEEDS_NETWORK } from "@/lib/offline";
import { Button, Card, Segmented, Sheet, Slider, Spinner } from "@/components/ui";
import {
  BackIcon,
  CheckIcon,
  CloseIcon,
  ContrastIcon,
  FastForwardIcon,
  MarkIcon,
  MoonIcon,
  PauseIcon,
  PlayIcon,
  ForwardIcon,
  RestartIcon,
  RewindIcon,
  SearchIcon,
  SettingsIcon,
  SparkIcon,
  SunIcon,
  VoiceIcon,
} from "@/components/icons";
import {
  clamp,
  FONT_FAMILIES,
  typographyVars,
  warmupFactor,
  warmupStart,
  WARMUP_WORDS,
  formatClock,
  formatNumber,
  isCompound,
  MAX_FONT_SCALE,
  MAX_LINE_HEIGHT,
  MAX_WPM,
  MIN_FONT_SCALE,
  MIN_LINE_HEIGHT,
  MIN_WPM,
  orpParts,
  parseParagraphs,
  sliceParagraphs,
  splitEmphasis,
  startsParagraph,
  type FontFamily,
  type Paragraph,
} from "@/lib/reading";
import { STYLE, styleClass } from "@/lib/markdown";
import { apiSend } from "@/lib/client";
import { QuizSheet } from "@/components/quiz-sheet";
import { NavigateSheet } from "@/components/navigate-sheet";
import { countCitations } from "@/lib/citations";
import {
  EYE_REST_AFTER_MS,
  EYE_REST_RESET_MS,
  EYE_REST_SECONDS,
  resumeTarget,
  runnerContext,
  sentenceBackTarget,
  sentenceForwardTarget,
} from "@/lib/navigation";
import { HighlightSheet } from "@/components/highlight-sheet";
import { WordSheet } from "@/components/word-sheet";
import { MIN_WORDS_FOR_QUIZ } from "@/lib/quiz";
import { useWordSelection, wordIndexFromPoint } from "@/hooks/use-word-selection";
import { useWordTouch } from "@/hooks/use-word-touch";
import { useSpeech } from "@/hooks/use-speech";
import { rateNotice } from "@/lib/speech";
import { normalizeWord, trimContext } from "@/lib/dictionary";
import { segmentsOf, sentenceRange, type Span, type StoredHighlight } from "@/lib/highlights";
import type { ContinuationResult, HighlightItem, NextUp, TextDetail } from "@/lib/types";
import {
  checkpointCrossed,
  highlightsBefore,
  normalizedWeights,
  pauseKinds,
  recapWindow,
  RHYTHM_HINTS,
  runnerDelayMs,
  wordKeyForPace,
  type PauseKind,
} from "@/lib/pacing";
import {
  addBrake,
  addPage,
  addWords,
  createMeter,
  running,
  startClock,
  stopClock,
  takeRecord,
  wallMs,
  MIN_WORDS_TO_RECORD,
  type SessionRecord,
} from "@/lib/reader-session";

/*
 * Uma tela so. Parado, o texto aparece em paginas, como num e-reader; ao
 * iniciar, o Word Runner cobre a pagina e mostra uma palavra por vez, com a
 * frase em volta embaixo (ou, no "guia na pagina", a palavra anda marcada na
 * propria pagina). Pausar devolve a pagina onde a leitura esta, com a palavra
 * atual marcada.
 *
 * O motor tem tres estados - parado, Word Runner e narracao - e toda parada
 * passa por `pause(motivo)`: freio, folha aberta, aba escondida, marco, ponto
 * de parada e descanso atualizam os mesmos acumuladores. Antes cada caminho
 * tinha a sua copia, e elas divergiam (sessao perdida, relogio congelado,
 * runner correndo atras das folhas).
 */

const PROGRESS_SAVE_INTERVAL_MS = 5_000;

/** Abaixo disso, retomar nao reinicia a rampa de aquecimento. */
const SHORT_PAUSE_MS = 3000;

/**
 * Depois do freio, o toque seguinte na pagina e ignorado por este tempo: o
 * segundo toque de um toque duplo no freio virava a pagina e pulava texto.
 */
const BRAKE_GUARD_MS = 450;

/**
 * Quanto a tela fica acesa depois do ultimo toque na pagina. Na leitura a
 * mao o leitor passa minutos sem tocar, e a tela apagava no meio da pagina.
 */
const PAGE_AWAKE_MS = 3 * 60_000;

/** Fracao da largura, em cada borda, em que o toque vira a pagina. */
const EDGE_FRACTION = 0.12;

/** Atraso para gravar a velocidade: um arraste do controle virava 19 PUTs. */
const SAVE_WPM_DELAY_MS = 400;

const PLAY_MODE_KEY = "rk-leitura:play-mode";
type PlayMode = "runner" | "guia";

type PauseReason =
  | "freio"
  | "folha"
  | "oculta"
  | "marco"
  | "parada"
  | "descanso"
  | "narracao"
  | "fim";

interface ReaderProps {
  text: TextDetail;
  highlights: HighlightItem[];
  startAt?: number;
  nextUp: NextUp | null;
  /** Fim do trecho sugerido por tempo livre (US-85). */
  stopAt?: number;
  /** Tempo previsto para o trecho sugerido. */
  plannedMs?: number;
  /** Palavras ja consultadas, que ganham tempo no Word Runner (US-88). */
  knownWords?: string[];
}

export function ReaderClient(props: ReaderProps) {
  return <Reader key={props.text.id} {...props} />;
}

/** Resumo da sessao que acabou, para a tela de conclusao. */
interface Summary {
  wordsRead: number;
  /** Relogio, com as pausas de pontuacao. */
  wallMs: number;
  /** Ppm configurado durante a leitura. */
  configuredWpm: number;
}

const PLAY_MODE_EVENT = "rk-leitura:play-mode";

function subscribePlayMode(onChange: () => void): () => void {
  window.addEventListener(PLAY_MODE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PLAY_MODE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readPlayMode(): PlayMode {
  try {
    return localStorage.getItem(PLAY_MODE_KEY) === "guia" ? "guia" : "runner";
  } catch {
    return "runner";
  }
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
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();
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
  // Estilo de cada palavra na lista corrida, para o Word Runner. Texto simples
  // nao tem estilo e fica sem a lista.
  const wordStyles = useMemo(
    () =>
      paragraphs.some((paragraph) => paragraph.styles)
        ? paragraphs.flatMap((paragraph) => paragraph.styles ?? paragraph.words.map(() => 0))
        : null,
    [paragraphs]
  );
  // Paragrafo de cada palavra: o Word Runner mostra o tipo do bloco (titulo,
  // item, citacao) sem buscar a cada palavra.
  const paragraphOf = useMemo(() => {
    const map = new Int32Array(total);
    paragraphs.forEach((paragraph, position) => {
      map.fill(position, paragraph.start, paragraph.start + paragraph.words.length);
    });
    return map;
  }, [paragraphs, total]);

  // Ritmo dinamico (US-87, US-88): o peso de cada palavra, normalizado para
  // a media do texto continuar na velocidade escolhida, e a pausa de
  // pontuacao depois dela. Desligado, toda palavra dura o mesmo.
  const adaptive = settings.adaptiveRhythm;
  // As regras de abreviatura e de fim de frase sao as do idioma do texto.
  const language = text.language;
  const weights = useMemo(() => {
    if (!adaptive) return null;
    const known = new Set(knownWords.map(wordKeyForPace));
    return normalizedWeights(words, known, paragraphs, language);
  }, [adaptive, words, knownWords, paragraphs, language]);
  const pauses = useMemo(
    () => (adaptive ? pauseKinds(words, paragraphs, language) : null),
    [adaptive, words, paragraphs, language]
  );

  /* --- velocidade -------------------------------------------------------- */
  // O valor em uso muda na hora; a gravacao na conta espera o arraste parar.
  const [pendingWpm, setPendingWpm] = useState<number | null>(null);
  const wpm = pendingWpm ?? settings.baseWpm;
  const saveWpmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeWpm = useCallback(
    (value: number) => {
      const next = clamp(Math.round(value), MIN_WPM, MAX_WPM);
      setPendingWpm(next);
      if (saveWpmTimer.current) clearTimeout(saveWpmTimer.current);
      saveWpmTimer.current = setTimeout(() => {
        void save({ baseWpm: next }).finally(() =>
          setPendingWpm((current) => (current === next ? null : current))
        );
      }, SAVE_WPM_DELAY_MS);
    },
    [save]
  );
  const warmup = settings.warmup;

  // Tempo de cada palavra na velocidade atual, acumulado: da o tempo que falta
  // e o ritmo real (com as pausas) sem percorrer o texto a cada render.
  const timeline = useMemo(() => {
    const sums = new Float64Array(total + 1);
    for (let position = 0; position < total; position += 1) {
      sums[position + 1] =
        sums[position]! +
        runnerDelayMs(wpm, weights?.[position] ?? 1, pauses?.[position] ?? "none", 1);
    }
    return sums;
  }, [total, wpm, weights, pauses]);
  const realWpm =
    total > 0 && timeline[total]! > 0 ? Math.round((total * 60_000) / timeline[total]!) : wpm;

  // `startAt` vem da lista de destaques: abrir um destaque posiciona a
  // leitura nele, em vez de onde a leitura tinha parado.
  const [index, setIndex] = useState(() =>
    clamp(startAt ?? text.progressIndex, 0, Math.max(0, total - 1))
  );
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  // Preferencia do aparelho, lida como loja externa: o HTML do servidor e o
  // primeiro render do cliente saem iguais ("runner"), e a troca vale na hora.
  const playMode = useSyncExternalStore(subscribePlayMode, readPlayMode, () => "runner" as PlayMode);
  const setPlayMode = useCallback((mode: PlayMode) => {
    try {
      localStorage.setItem(PLAY_MODE_KEY, mode);
    } catch {
      // Sem armazenamento: a preferencia nao persiste.
    }
    window.dispatchEvent(new Event(PLAY_MODE_EVENT));
  }, []);
  const runnerVisible = playing && playMode === "runner";

  // Posicao em que a leitura corrente comecou: a rampa de aquecimento conta a
  // partir dela, nao do inicio do texto.
  const warmupOriginRef = useRef(0);
  // Fator em que a rampa comeca: proporcional ao tempo parado (60% na
  // abertura ou depois de 2 minutos, 85% depois de uma pausa curta).
  const warmupStartRef = useRef(warmupStart(null));
  // Quando a leitura parou. Uma pausa curta nao reinicia a rampa.
  const pausedAtRef = useRef(0);
  // Posicao em que a leitura parou: o recuo ao retomar (US-95) so vale se o
  // leitor nao escolheu outra posicao durante a pausa.
  const pausedIndexRef = useRef(-1);
  // Inicio da palavra atual no relogio do Word Runner. O prazo de cada
  // palavra e absoluto (inicio + duracao): o custo de render nao se acumula,
  // e mudar a velocidade no meio nao reinicia a palavra.
  const wordStartRef = useRef(0);
  const brakeAtRef = useRef(0);

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

  // A pagina fica montada (so invisivel) enquanto o Word Runner roda: assim a
  // paginacao continua medida e pausar mostra a pagina certa na hora.
  const emphasis = settings.wordEmphasis;
  const layoutKey = `${settings.fontScale}:${settings.fontFamily}:${settings.lineHeightStep}`;
  const { frameRef, rulerRef, pages, ready: pagesReady } = usePagedText(
    paragraphs,
    total,
    emphasis,
    layoutKey
  );
  const currentPage = pageOfWord(pages, index);
  const pageStart = pages[currentPage] ?? 0;
  const pageEnd = pages[currentPage + 1] ?? total;

  /* --- espelho para handlers fora do render ------------------------------- */
  const stateRef = useRef({ index, playing, total, textId: text.id, narrating: false });
  useEffect(() => {
    stateRef.current.index = index;
    stateRef.current.playing = playing;
    stateRef.current.total = total;
    stateRef.current.textId = text.id;
  }, [index, playing, total, text.id]);

  /* --- contabilidade da sessao ------------------------------------------ */
  const meterRef = useRef(createMeter());
  const savedIndexRef = useRef(index);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [comprehension, setComprehension] = useState<number | null>(null);
  // Tempo lido nesta visita, somado a cada sessao fechada: o cabecalho nao
  // pode voltar a 0:00 so porque uma sessao foi gravada.
  const visitMsRef = useRef(0);
  const [displayMs, setDisplayMs] = useState(0);

  /**
   * Tempo previsto do trecho sugerido (US-85). Vai so na primeira sessao
   * gravada: a que cobre o trecho; o que se le depois dele nao foi previsto.
   */
  const plannedRef = useRef(plannedMs);

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

  const postRecord = useCallback(
    (record: SessionRecord | null, completed: boolean, useKeepalive = false) => {
      if (!record) return;
      visitMsRef.current += record.wallMs;
      const planned = plannedRef.current;
      plannedRef.current = undefined;
      void fetch("/api/reading-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          textId: text.id,
          wordsRead: record.wordsRead,
          durationMs: record.durationMs,
          completed,
          narrated: record.mode === "narracao",
          mode: record.mode,
          brakes: record.brakes,
          plannedMs: planned,
        }),
        keepalive: useKeepalive,
      }).catch(() => undefined);
    },
    [text.id]
  );

  /** Grava a sessao aberta (se houver o que gravar). O relogio segue como estava. */
  const flushSession = useCallback(
    (completed: boolean, useKeepalive = false) => {
      const meter = meterRef.current;
      const now = Date.now();
      // Sessao curta demais para gravar ainda conta no relogio da visita.
      const wall = wallMs(meter, now);
      const record = takeRecord(meter, now);
      if (record) postRecord(record, completed, useKeepalive);
      else visitMsRef.current += wall;
    },
    [postRecord]
  );

  /* --- avisos para leitor de tela ------------------------------------------ */
  // A palavra do Word Runner nao e anunciada (a 300 ppm inundaria o leitor de
  // tela); o que se anuncia e a mudanca de estado.
  const [announcement, setAnnouncement] = useState("");

  /* --- destaques --------------------------------------------------------- */
  const [marks, setMarks] = useState<HighlightItem[]>(highlights);
  const [openMark, setOpenMark] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  // Selecionar texto so faz sentido com a pagina na tela; no Word Runner a
  // unidade que da para apontar sem parar a leitura e a frase.
  const selectable = !runnerVisible && !finished;
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
        // Durante o Word Runner o aviso e so para leitor de tela: um aviso
        // visual cobria o botao de pausa por 4 segundos.
        if (stateRef.current.playing) setAnnouncement("Frase destacada.");
        else notify("Trecho destacado.", "success");
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

  /** Destaca a frase que contem a palavra atual, sem parar a leitura. */
  const markSentenceAt = useCallback(
    (position: number) => {
      const range = sentenceRange(words, position, language);
      if (range) void createMark(range);
    },
    [words, createMark, language]
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
  // Toque longo so com a pagina na tela; no Word Runner o toque e o freio.
  const word = useWordTouch(!runnerVisible && !finished);

  /* --- leitura na pagina ------------------------------------------------- */
  // Quando a pagina atual entrou na tela e de que palavra a leitura dela
  // comecou. Virar para a frente conta a pagina como lida (PROD-2).
  const pageEnteredRef = useRef({ at: 0, from: index });
  useEffect(() => {
    pageEnteredRef.current = { at: Date.now(), from: stateRef.current.index };
  }, []);
  const [pageAwake, setPageAwake] = useState(true);
  const awakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchPage = useCallback(() => {
    setPageAwake(true);
    if (awakeTimer.current) clearTimeout(awakeTimer.current);
    awakeTimer.current = setTimeout(() => setPageAwake(false), PAGE_AWAKE_MS);
  }, []);
  useEffect(() => {
    awakeTimer.current = setTimeout(() => setPageAwake(false), PAGE_AWAKE_MS);
    return () => {
      if (awakeTimer.current) clearTimeout(awakeTimer.current);
    };
  }, []);

  /* --- voz alta ---------------------------------------------------------- */
  // A voz e a do idioma do texto, nao a da interface (US-68).
  const speech = useSpeech(text.language);
  const narrating = speech.state === "falando";
  useEffect(() => {
    stateRef.current.narrating = narrating;
  }, [narrating]);

  useWakeLock(playing || narrating || (pageAwake && !finished));

  /* --- paradas no meio da leitura ---------------------------------------- */
  const initialWpmRef = useRef(wpm);
  const [stopReached, setStopReached] = useState(false);
  const stopReachedRef = useRef(false);
  const [stopInfo, setStopInfo] = useState<{ realMs: number; speedChanged: boolean } | null>(
    null
  );
  const answeredRef = useRef(text.checkpointAnswered);
  const [checkpoint, setCheckpoint] = useState<number | null>(null);
  const askCheckpoints = settings.askCheckpoints && !text.abandoned;
  const resumeRewind = settings.resumeRewind;
  const eyeRest = settings.eyeRest;

  // Descanso da vista (US-104): tempo de leitura continua desde a ultima
  // parada longa. Parar por menos de 2 minutos nao conta como descanso.
  const restAccumRef = useRef(0);
  const restStartRef = useRef<number | null>(null);
  const [resting, setResting] = useState(false);

  // Onde a leitura estava antes de um salto (PROD-15): a pagina virada a mao
  // para tras, a busca ou o sumario nao podem fazer perder o lugar.
  const [anchor, setAnchor] = useState(index);
  // Palavra escolhida por toque: fica marcada mesmo sendo a primeira da pagina.
  const [tapped, setTapped] = useState<number | null>(null);

  const playButtonRef = useRef<HTMLButtonElement>(null);

  /**
   * Para o Word Runner, por qualquer motivo. Unico caminho de parada: todos
   * os acumuladores (sessao, descanso, recuo, rampa) andam juntos.
   */
  const pause = useCallback(
    (reason: PauseReason) => {
      if (!stateRef.current.playing) return;
      const now = Date.now();
      const position = stateRef.current.index;
      stopClock(meterRef.current, now);
      pausedAtRef.current = now;
      pausedIndexRef.current = position;
      if (reason === "freio") {
        addBrake(meterRef.current, position);
        brakeAtRef.current = now;
      }
      if (restStartRef.current !== null) restAccumRef.current += now - restStartRef.current;
      restStartRef.current = null;
      saveProgress(position);
      pageEnteredRef.current = { at: now, from: position };
      stateRef.current.playing = false;
      setPlaying(false);
      setAnchor(position);
      touchPage();
      setAnnouncement(
        `Pausado na palavra ${formatNumber(position + 1)} de ${formatNumber(stateRef.current.total)}.`
      );
    },
    [saveProgress, touchPage]
  );

  /** Fim do texto, por qualquer caminho: Word Runner, narracao ou pagina. */
  const finish = useCallback(
    (configured: number) => {
      const meter = meterRef.current;
      const now = Date.now();
      stopClock(meter, now);
      const done: Summary = {
        wordsRead: meter.words,
        wallMs: wallMs(meter, now),
        configuredWpm: configured,
      };
      stateRef.current.playing = false;
      setPlaying(false);
      setIndex(stateRef.current.total);
      setFinished(true);
      saveProgress(stateRef.current.total);
      setSummary(done);
      flushSession(true);
      setAnnouncement("Leitura concluida.");
    },
    [saveProgress, flushSession]
  );

  /** Liga o Word Runner (ou o guia na pagina) na posicao atual. */
  const narrationStopRef = useRef<() => void>(() => undefined);
  const start = useCallback(() => {
    if (stateRef.current.playing) return;
    if (stateRef.current.index >= stateRef.current.total) return;
    if (stateRef.current.narrating) narrationStopRef.current();
    speech.clearError();

    const now = Date.now();
    const pausedMs = pausedAtRef.current > 0 ? now - pausedAtRef.current : Number.POSITIVE_INFINITY;
    const moved = pausedIndexRef.current !== stateRef.current.index;

    // Recua algumas palavras depois de uma pausa longa (US-95), desde que a
    // posicao seja a mesma em que a leitura parou.
    let from = stateRef.current.index;
    if (resumeRewind && !moved && Number.isFinite(pausedMs)) {
      const target = resumeTarget(words, from, pausedMs, paragraphs, wpm, language);
      if (target !== from) {
        from = target;
        stateRef.current.index = target;
        setIndex(target);
      }
    }
    pausedIndexRef.current = -1;

    // Pausa curta sem mudar de lugar nao reinicia a rampa. Mudou de lugar (ou
    // recuou), a rampa recomeca dali: antes ela ficava presa em 60% quando a
    // posicao voltava para antes da origem.
    if (pausedMs >= SHORT_PAUSE_MS || moved || from < warmupOriginRef.current) {
      warmupOriginRef.current = from;
      warmupStartRef.current = warmupStart(moved ? null : pausedMs);
    }

    if (pausedAtRef.current === 0 || pausedMs >= EYE_REST_RESET_MS) restAccumRef.current = 0;
    restStartRef.current = now;

    postRecord(startClock(meterRef.current, "runner", now), false);
    wordStartRef.current = performance.now();
    stateRef.current.playing = true;
    setFinished(false);
    setTapped(null);
    setPlaying(true);
    setAnnouncement(playMode === "guia" ? "Guia na pagina iniciado." : "Word Runner iniciado.");
  }, [resumeRewind, words, paragraphs, wpm, language, postRecord, playMode, speech]);

  const togglePlay = useCallback(() => {
    if (stateRef.current.playing) pause("freio");
    else start();
  }, [pause, start]);

  /* --- motor de avanco --------------------------------------------------- */
  useEffect(() => {
    if (!playing) return;
    if (index >= total) return;

    // Uma palavra por vez. A rampa de aquecimento vale a partir de onde a
    // leitura corrente comecou.
    const factor = warmup
      ? warmupFactor(index - warmupOriginRef.current, warmupStartRef.current)
      : 1;
    const weight = weights?.[index] ?? 1;
    const kind: PauseKind = pauses?.[index] ?? "none";
    const delay = runnerDelayMs(wpm, weight, kind, factor);
    // O que passa da duracao nominal da palavra e pausa ou rampa: sai do
    // tempo da sessao, para o ritmo medido ser o das palavras.
    const credit = Math.max(0, delay - (60_000 / wpm) * weight);

    const now = performance.now();
    let due = wordStartRef.current + delay;
    // Muito atrasado (aba em segundo plano, aparelho lento): recomeca o
    // relogio em vez de disparar uma rajada de palavras para alcancar.
    if (due < now - 250) due = now;

    const timer = setTimeout(() => {
      wordStartRef.current = due;
      addWords(meterRef.current, 1, credit);
      const next = index + 1;

      if (next >= total) {
        finish(wpm);
        return;
      }

      stateRef.current.index = next;
      setIndex(next);

      if (stopAt !== undefined && !stopReachedRef.current && next >= stopAt) {
        stopReachedRef.current = true;
        setStopReached(true);
        const realMs = wallMs(meterRef.current, Date.now());
        pause("parada");
        flushSession(false);
        setStopInfo({ realMs, speedChanged: wpm !== initialWpmRef.current });
        return;
      }

      const marker = askCheckpoints ? checkpointCrossed(next, total, answeredRef.current) : null;
      if (marker !== null) {
        pause("marco");
        setCheckpoint(marker);
      }
    }, Math.max(0, due - now));

    return () => clearTimeout(timer);
  }, [
    playing,
    index,
    wpm,
    total,
    warmup,
    weights,
    pauses,
    stopAt,
    askCheckpoints,
    finish,
    pause,
    flushSession,
  ]);

  /* --- cronometro visivel ------------------------------------------------ */
  useEffect(() => {
    const tick = () => setDisplayMs(visitMsRef.current + wallMs(meterRef.current, Date.now()));
    tick();
    if (!playing && !narrating) return;
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [playing, narrating, index]);

  /* --- persistencia ------------------------------------------------------ */
  useEffect(() => {
    if (!playing && !narrating) return;
    const timer = setInterval(
      () => saveProgress(stateRef.current.index),
      PROGRESS_SAVE_INTERVAL_MS
    );
    return () => clearInterval(timer);
  }, [playing, narrating, saveProgress]);

  // Aba escondida, aparelho bloqueado ou pagina fechada: o Word Runner para
  // (ninguem le uma tela apagada) e a sessao e gravada, com ou sem leitura em
  // andamento. A narracao continua tocando, e o relogio dela tambem.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== "hidden") {
        // De volta: o tempo com a aba escondida nao e leitura de pagina.
        pageEnteredRef.current = { at: Date.now(), from: stateRef.current.index };
        return;
      }
      pause("oculta");
      saveProgress(stateRef.current.index, true);
      flushSession(false, true);
    };
    const onPageHide = () => {
      pause("oculta");
      saveProgress(stateRef.current.index, true);
      flushSession(false, true);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [pause, saveProgress, flushSession]);

  // Sair do leitor pela navegacao do app (desmontar) tambem grava.
  useEffect(
    () => () => {
      const meter = meterRef.current;
      stopClock(meter, Date.now());
      saveProgress(stateRef.current.index, true);
      postRecord(takeRecord(meter, Date.now()), false, true);
    },
    [saveProgress, postRecord]
  );

  // Aviso de descanso: agenda para quando a leitura continua completar o
  // intervalo; pausar desarma, e o tempo ja lido fica acumulado.
  useEffect(() => {
    if (!playing || !eyeRest) return;
    const runningFor = restStartRef.current !== null ? Date.now() - restStartRef.current : 0;
    const remaining = Math.max(0, EYE_REST_AFTER_MS - restAccumRef.current - runningFor);
    const timer = setTimeout(() => {
      if (!stateRef.current.playing) return;
      pause("descanso");
      setResting(true);
    }, remaining);
    return () => clearTimeout(timer);
  }, [playing, eyeRest, pause]);

  /* --- narracao ------------------------------------------------------------ */
  // Posicao anterior da propria narracao: a contagem anda por ela, nao pelo
  // espelho de estado, que so e atualizado por um efeito.
  const narratedFromRef = useRef(0);

  const startNarration = useCallback(
    (from: number) => {
      narratedFromRef.current = from;
      const began = speech.start({
        from,
        wpm,
        words,
        onWord: (position) => {
          addWords(meterRef.current, Math.max(0, position - narratedFromRef.current));
          narratedFromRef.current = position;
          stateRef.current.index = position;
          setIndex(position);
        },
        onEnd: () => {
          addWords(meterRef.current, Math.max(0, stateRef.current.total - narratedFromRef.current));
          finish(wpm);
        },
      });
      if (!began) return false;
      postRecord(startClock(meterRef.current, "narracao", Date.now()), false);
      setFinished(false);
      const notice = rateNotice(wpm);
      if (notice) notify(notice, "info");
      return true;
    },
    [speech, wpm, words, finish, postRecord, notify]
  );

  const stopNarration = useCallback(() => {
    speech.stop();
    const now = Date.now();
    stopClock(meterRef.current, now);
    flushSession(false);
    saveProgress(stateRef.current.index);
    pageEnteredRef.current = { at: now, from: stateRef.current.index };
    setAnchor(stateRef.current.index);
  }, [speech, flushSession, saveProgress]);
  useEffect(() => {
    narrationStopRef.current = stopNarration;
  }, [stopNarration]);

  // A fala parou sozinha (erro, fim da fila de uma voz): o relogio para junto.
  useEffect(() => {
    if (narrating) return;
    const meter = meterRef.current;
    if (meter.mode === "narracao" && running(meter)) {
      stopClock(meter, Date.now());
      flushSession(false);
    }
  }, [narrating, flushSession]);

  /**
   * Liga e desliga a narracao. A fala conduz a posicao: o Word Runner para
   * antes, senao dois relogios disputariam o mesmo indice.
   */
  const toggleSpeech = useCallback(() => {
    if (stateRef.current.narrating) {
      stopNarration();
      return;
    }
    if (stateRef.current.index >= stateRef.current.total) return;
    if (stateRef.current.playing) pause("narracao");
    startNarration(stateRef.current.index);
  }, [stopNarration, startNarration, pause]);

  /* --- posicao ---------------------------------------------------------- */
  /**
   * Muda a posicao de leitura. Unico caminho, para que a narracao recomece da
   * posicao nova (antes a fala desfazia a mudanca) e o Word Runner siga dali.
   */
  const seek = useCallback(
    (position: number) => {
      const target = clamp(position, 0, Math.max(0, stateRef.current.total - 1));
      const now = Date.now();
      stateRef.current.index = target;
      setIndex(target);
      setFinished(false);
      pageEnteredRef.current = { at: now, from: target };
      if (stateRef.current.playing) {
        // Correndo, a navegacao por frase nao reinicia a rampa.
        wordStartRef.current = performance.now();
        warmupOriginRef.current = target - WARMUP_WORDS;
      }
      if (stateRef.current.narrating) startNarration(target);
    },
    [startNarration]
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
        stateRef.current.index = resumeAt;
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

  /**
   * Vira a pagina. Para a frente, a pagina deixada conta como lida quando o
   * tempo nela foi plausivel; da ultima pagina, a leitura termina. A leitura
   * seguinte comeca no topo da pagina nova.
   */
  const turnPage = useCallback(
    (direction: 1 | -1) => {
      const now = Date.now();
      if (now - brakeAtRef.current < BRAKE_GUARD_MS) return;
      touchPage();
      setTapped(null);
      const position = stateRef.current.index;
      const page = pageOfWord(pages, position);
      const target = pages[page + direction];

      if (direction === 1 && !stateRef.current.playing && !stateRef.current.narrating) {
        const from = Math.max(pages[page] ?? 0, pageEnteredRef.current.from);
        const end = pages[page + 1] ?? stateRef.current.total;
        const { closed } = addPage(meterRef.current, end - from, now - pageEnteredRef.current.at, now);
        postRecord(closed, false);
      }

      if (target === undefined) {
        if (direction === -1) {
          // Na primeira pagina, voltar nao mexe na posicao escolhida.
          notify("Inicio do texto.", "info");
          return;
        }
        // Fim do que ja foi importado: tenta trazer a proxima parte da origem;
        // texto colado ou sem mais partes termina aqui.
        if (text.sourceUrl) {
          void continueFromSource().then((appended) => {
            if (!appended) finish(wpm);
          });
        } else {
          finish(wpm);
        }
        return;
      }

      // Para a frente, uma pagina: e leitura, o lugar anda junto. Para tras,
      // o lugar fica, e o atalho de volta aparece.
      if (direction === 1 && Math.abs(pageOfWord(pages, anchor) - page) <= 1) setAnchor(target);
      seek(target);
    },
    [pages, anchor, seek, touchPage, postRecord, notify, text.sourceUrl, continueFromSource, finish, wpm]
  );

  /** Toque na pagina: borda vira, palavra passa a ser o inicio da leitura. */
  const onPageTap = useCallback(
    (position: number | null, edge: -1 | 0 | 1) => {
      if (Date.now() - brakeAtRef.current < BRAKE_GUARD_MS) return;
      if (word.recentLongPress()) return;
      if (edge !== 0) {
        turnPage(edge);
        return;
      }
      if (position === null) return;
      touchPage();
      seek(position);
      setTapped(position);
      setAnchor(position);
    },
    [turnPage, seek, touchPage, word]
  );

  /** Volta ao inicio da frase, ou da anterior quando ja esta no inicio (US-91). */
  const backSentence = useCallback(() => {
    if (stateRef.current.playing) addBrake(meterRef.current, stateRef.current.index);
    seek(sentenceBackTarget(words, stateRef.current.index, language));
  }, [words, seek, language]);

  /** Avanca para o inicio da proxima frase, como as setas do Word Runner. */
  const forwardSentence = useCallback(() => {
    seek(sentenceForwardTarget(words, stateRef.current.index, language));
  }, [words, seek, language]);

  /** Vai para uma posicao escolhida na navegacao, com a leitura pausada. */
  const goTo = useCallback(
    (position: number) => {
      if (stateRef.current.playing) pause("folha");
      seek(position);
    },
    [pause, seek]
  );

  const [navigating, setNavigating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);

  // Consultar uma palavra pausa a leitura, e fechar o painel nao a retoma
  // sozinha: quem parou para entender uma palavra decide quando voltar.
  const wordOpen = word.touched !== null;

  /* --- referencias (texto ja salvo) -------------------------------------- */
  // Conta so quando a folha de ajustes abre: e uma varredura do texto inteiro.
  const citations = useMemo(
    () => (showSettings ? countCitations(text.content) : 0),
    [showSettings, text.content]
  );
  const [reprocessing, setReprocessing] = useState(false);
  const reprocess = useCallback(
    async (acao: "omitir" | "restaurar") => {
      setReprocessing(true);
      saveProgress(stateRef.current.index);
      try {
        const result = await apiSend<{ status: string; message?: string }>(
          `/api/texts/${text.id}/referencias`,
          "POST",
          { acao }
        );
        if (result.status === "unchanged") {
          notify(result.message ?? "Nada a mudar.", "info");
          setReprocessing(false);
          return;
        }
        // O texto inteiro muda de indices: recarregar e o jeito seguro de o
        // leitor, os destaques e a posicao voltarem juntos. A sessao aberta
        // e gravada antes - o reload nao passa pelo desmontar.
        flushSession(false, true);
        window.location.reload();
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : "Nao consegui reprocessar.", "error");
        setReprocessing(false);
      }
    },
    [text.id, notify, saveProgress, flushSession]
  );

  const restart = useCallback(() => {
    pause("folha");
    setFinished(false);
    setSummary(null);
    setAnchor(0);
    seek(0);
    saveProgress(0);
  }, [pause, seek, saveProgress]);

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
      pausedIndexRef.current = stateRef.current.index;
      warmupOriginRef.current = stateRef.current.index - WARMUP_WORDS;
      start();
    },
    [start]
  );

  const [abandoning, setAbandoning] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const concluded = text.wordCount > 0 && text.progressIndex >= text.wordCount;

  // Qualquer folha aberta para o Word Runner: antes ele seguia correndo atras
  // dos Ajustes e da navegacao, e as palavras contavam como lidas.
  const sheetOpen =
    showSettings ||
    navigating ||
    shortcutsOpen ||
    openMark !== null ||
    wordOpen ||
    confirmAbandon ||
    confirmRestart ||
    quizOpen;
  useEffect(() => {
    if (sheetOpen && stateRef.current.playing) pause("folha");
  }, [sheetOpen, pause]);

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
    start();
  }, [checkpoint, text.id, start]);

  /** Consulta a palavra atual no dicionario, sem ponteiro (teclado). */
  const lookupCurrent = useCallback(() => {
    const position = Math.min(stateRef.current.index, words.length - 1);
    const current = normalizeWord(words[position]);
    if (!current) return;
    const around = words.slice(Math.max(0, position - 12), position + 12).join(" ");
    word.open({ word: current, context: trimContext(around), index: position });
  }, [words, word]);

  /* --- teclado (desktop) -------------------------------------------------- */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      // Com uma folha aberta, as teclas sao dela (Esc fecha, Tab navega).
      if (document.body.dataset.sheet) return;
      // Na recapitulacao nada de atalho: o Espaco ligava o Word Runner
      // escondido atras dela.
      if (recapPlaying) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.code === "Space" || event.key === "k" || event.key === "K") {
        // Espaco num botao ou controle e do botao: so e play/pausa quando o
        // foco esta no texto ou em lugar nenhum.
        if (
          event.code === "Space" &&
          target?.closest("button, a, [role=button], [role=slider], [role=radio], [role=tab], summary")
        ) {
          return;
        }
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft" && event.shiftKey) {
        event.preventDefault();
        backSentence();
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        // Velocidade pelo teclado (US-93), nos mesmos limites do controle.
        event.preventDefault();
        changeWpm(wpm + (event.key === "ArrowUp" ? 25 : -25));
      } else if (event.key === "?") {
        setShortcutsOpen(true);
      } else if (event.key === "/") {
        event.preventDefault();
        setNavigating(true);
      } else if (event.key === "d" || event.key === "D") {
        lookupCurrent();
      } else if (event.key === "h" || event.key === "H") {
        markSentenceAt(stateRef.current.index);
      } else if (event.key === "ArrowLeft") {
        // Correndo, as setas andam por frase; parado, viram a pagina.
        if (stateRef.current.playing) backSentence();
        else turnPage(-1);
      } else if (event.key === "ArrowRight") {
        if (stateRef.current.playing) forwardSentence();
        else turnPage(1);
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
  }, [
    togglePlay,
    turnPage,
    backSentence,
    forwardSentence,
    wpm,
    changeWpm,
    recapPlaying,
    lookupCurrent,
    markSentenceAt,
  ]);

  // Pausar pelo toque no Word Runner tira o foco da tela: ele volta para o
  // botao de play, onde quem usa teclado continua.
  const brakeFromRunner = useCallback(() => {
    pause("freio");
    requestAnimationFrame(() => playButtonRef.current?.focus({ preventScroll: true }));
  }, [pause]);

  // Os avisos flutuantes ficam acima do rodape do leitor, sem cobrir o play.
  const footerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const footer = footerRef.current;
    const root = document.documentElement;
    if (!footer) return;
    const apply = () =>
      root.style.setProperty("--toast-offset", `${Math.round(footer.offsetHeight + 8)}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(footer);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--toast-offset");
    };
  }, [finished, recapPlaying]);

  const progress = total > 0 ? Math.min(100, (index / total) * 100) : 0;
  // A primeira palavra do texto nao precisa de aviso: nao ha paragrafo antes.
  const paragraphStart = index > 0 && startsParagraph(paragraphs, index);
  // Na pagina, a palavra atual e marcada depois de pausar, durante a narracao
  // e no guia; e a palavra tocada, mesmo sendo a primeira da pagina.
  const currentOnPage = runnerVisible
    ? null
    : playing || narrating || index > pageStart || tapped === index
      ? index
      : null;
  const remainingMs = Math.max(0, timeline[total]! - timeline[Math.min(index, total)]!);
  const anchorPage = pageOfWord(pages, anchor);
  const showReturn =
    !playing && !narrating && !finished && pagesReady && anchorPage !== currentPage && anchor < total;
  const stopPage = stopAt !== undefined ? pageOfWord(pages, stopAt) + 1 : null;
  const [clockMode, setClockMode] = useState<"restante" | "lido">("restante");

  const onSpeedChange = useCallback((value: number) => changeWpm(value), [changeWpm]);

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

  const currentParagraph = paragraphs[paragraphOf[Math.min(index, total - 1)] ?? 0];

  return (
    <div
      // Altura fixa: nada que entra ou sai (avisos, barra de selecao, linha
      // da pagina) muda o tamanho do quadro e dispara a paginacao de novo.
      className="flex h-dvh flex-col overflow-hidden bg-bg"
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
      <header className="pt-safe z-20 shrink-0 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-2 py-2">
          <Link
            href="/textos"
            aria-label="Voltar"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
          >
            <BackIcon className="size-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-medium">{text.title}</h1>
            <button
              type="button"
              onClick={() => setClockMode((mode) => (mode === "restante" ? "lido" : "restante"))}
              className="tabular -mx-1 rounded px-1 text-left text-xs text-muted hover:text-ink"
              aria-label={
                clockMode === "restante"
                  ? "Mostrar o tempo lido"
                  : "Mostrar o tempo que falta"
              }
            >
              {formatNumber(Math.min(index + 1, total))} / {formatNumber(total)} &middot;{" "}
              {clockMode === "restante"
                ? `faltam ${formatRemaining(remainingMs)}`
                : `${formatClock(displayMs)} lidos`}
            </button>
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
        <div className="relative h-0.5 bg-surface-2">
          <div
            className="h-full bg-accent transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
          {stopAt !== undefined && !stopReached ? (
            <span
              aria-hidden="true"
              className="absolute -top-1 h-2.5 w-0.5 rounded bg-ink"
              style={{ left: `${Math.min(100, (stopAt / total) * 100)}%` }}
            />
          ) : null}
        </div>
      </header>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <main
        className={`relative flex min-h-0 flex-1 flex-col ${finished || recapPlaying ? "overflow-y-auto" : ""}`}
      >
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
            summary={summary}
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
        ) : (
          <>
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
              current={currentOnPage}
              hidden={runnerVisible}
              touch={word.handlers}
              onTurn={turnPage}
              onTap={onPageTap}
              onOpenMark={setOpenMark}
            />
            {runnerVisible ? (
              <RunnerStage
                words={words}
                paragraphs={paragraphs}
                index={index}
                style={wordStyles?.[index] ?? 0}
                paragraphStart={paragraphStart}
                block={currentParagraph}
                language={language}
                onBrake={brakeFromRunner}
              />
            ) : null}
          </>
        )}
      </main>

      {!finished && !recapPlaying ? (
        <footer
          ref={footerRef}
          className="pb-safe relative z-20 shrink-0 border-t border-border bg-bg/95 backdrop-blur"
        >
          {/* Tudo o que aparece por cima (avisos, barra de selecao, voltar ao
              lugar) flutua acima do rodape, fora do fluxo: entrar ou sair nao
              muda a altura do quadro nem refaz as paginas. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-full flex flex-col items-center gap-2 px-4 pb-2">
            {text.abandoned && !resumed ? (
              <div className="pointer-events-auto flex w-full max-w-3xl items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-float">
                <p className="flex-1 text-sm">Voce largou este texto. Ele esta fora da biblioteca.</p>
                <Button size="sm" onClick={() => void resume()}>
                  Retomar
                </Button>
              </div>
            ) : null}

            {recap && !playing ? (
              <div className="pointer-events-auto w-full max-w-3xl space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-float">
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
            ) : null}

            {speech.error ? (
              <div
                role="alert"
                className="pointer-events-auto flex w-full max-w-3xl items-start gap-2 rounded-2xl border border-danger/40 bg-surface p-3 text-sm shadow-float"
              >
                <p className="flex-1">
                  {speech.error}{" "}
                  <Link href="/ajustes#vozes" className="font-medium text-accent underline">
                    Vozes em Ajustes
                  </Link>
                </p>
                <button
                  type="button"
                  aria-label="Fechar aviso"
                  onClick={speech.clearError}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
                >
                  <CloseIcon className="size-5" />
                </button>
              </div>
            ) : null}

            {selection && !finished ? (
              <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-surface p-1 shadow-float">
                <Button size="md" loading={marking} onClick={() => void createMark(selection)}>
                  <MarkIcon className="size-5" />
                  Destacar
                </Button>
                <ControlButton label="Cancelar selecao" onClick={clearSelection}>
                  <CloseIcon className="size-5" />
                </ControlButton>
              </div>
            ) : null}

            {showReturn && !selection ? (
              <button
                type="button"
                onClick={() => seek(anchor)}
                className="pointer-events-auto min-h-11 rounded-full border border-border bg-surface px-4 text-sm font-medium shadow-float"
              >
                {`Voltar para onde parou (p. ${anchorPage + 1})`}
              </button>
            ) : null}

            {speedOpen ? (
              <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-border bg-surface p-4 shadow-float">
                <Slider
                  label="Velocidade"
                  display={`${wpm} ppm`}
                  min={MIN_WPM}
                  max={MAX_WPM}
                  step={10}
                  hint={speedHint(wpm, adaptive ? realWpm : null)}
                  value={wpm}
                  onChange={onSpeedChange}
                />
              </div>
            ) : null}
          </div>

          <div className="mx-auto w-full max-w-3xl px-4 py-2">
            {/* Grade fixa: parado e correndo tem os mesmos lugares, e o play
                nao sai do centro, onde o polegar o procura. */}
            <div className="grid grid-cols-5 items-center justify-items-center">
              {!playing ? (
                <ControlButton
                  label={narrating ? "Parar a narracao" : "Ler em voz alta"}
                  onClick={toggleSpeech}
                  active={narrating}
                >
                  <VoiceIcon className="size-5" />
                </ControlButton>
              ) : (
                <span aria-hidden="true" className="size-12" />
              )}

              {playing ? (
                <ControlButton label="Voltar a frase" onClick={backSentence}>
                  <RewindIcon className="size-5" />
                </ControlButton>
              ) : (
                <ControlButton label="Pagina anterior" onClick={() => turnPage(-1)}>
                  <BackIcon className="size-5" />
                </ControlButton>
              )}

              <button
                ref={playButtonRef}
                type="button"
                onClick={togglePlay}
                aria-label={playing ? "Pausar" : "Iniciar leitura"}
                className="flex size-16 items-center justify-center rounded-full bg-accent text-accent-ink shadow-float transition-transform active:scale-95"
              >
                {playing ? <PauseIcon className="size-7" /> : <PlayIcon className="size-7" />}
              </button>

              {playing ? (
                <ControlButton label="Avancar a frase" onClick={forwardSentence}>
                  <FastForwardIcon className="size-5" />
                </ControlButton>
              ) : (
                <ControlButton label="Proxima pagina" onClick={() => turnPage(1)}>
                  <ForwardIcon className="size-5" />
                </ControlButton>
              )}

              <ControlButton label="Destacar frase" onClick={() => markSentenceAt(index)}>
                <MarkIcon className="size-5" />
              </ControlButton>
            </div>

            <div className="mt-1 flex min-h-11 items-center justify-between gap-2 text-sm">
              <button
                type="button"
                onClick={() => setSpeedOpen((open) => !open)}
                aria-expanded={speedOpen}
                aria-label={`Velocidade: ${wpm} ppm`}
                className={`tabular min-h-11 shrink-0 rounded-full border px-3 font-medium ${
                  speedOpen ? "border-accent text-accent" : "border-border text-muted"
                }`}
              >
                {`${wpm} ppm`}
              </button>
              <p className="tabular min-w-0 flex-1 truncate text-right text-muted">
                {playing
                  ? adaptive
                    ? `~${realWpm} ppm reais`
                    : `${wpm} ppm`
                  : pagesReady
                    ? stopPage !== null && !stopReached
                      ? `Pagina ${currentPage + 1} de ${pages.length} · trecho ate a p. ${stopPage}${
                          plannedMs ? ` (~${formatClock(plannedMs)})` : ""
                        }`
                      : `Pagina ${currentPage + 1} de ${pages.length}`
                    : ""}
              </p>
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

      <Sheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Como usar o leitor">
        <div className="space-y-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {GESTURES.map(([gesture, action]) => (
              <div key={gesture} className="contents">
                <dt className="font-medium">{gesture}</dt>
                <dd className="text-muted">{action}</dd>
              </div>
            ))}
          </dl>
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
        </div>
      </Sheet>

      <EyeRestSheet
        open={resting}
        onClose={() => {
          // O descanso zera a contagem: os proximos 20 minutos comecam agora.
          restAccumRef.current = 0;
          setResting(false);
        }}
        onContinue={() => {
          restAccumRef.current = 0;
          setResting(false);
          start();
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
          <Slider
            label="Velocidade"
            display={`${wpm} ppm`}
            min={MIN_WPM}
            max={MAX_WPM}
            step={10}
            hint={speedHint(wpm, adaptive ? realWpm : null)}
            value={wpm}
            onChange={onSpeedChange}
          />

          <div className="space-y-2">
            <Segmented<"dinamico" | "uniforme">
              label="Ritmo"
              value={adaptive ? "dinamico" : "uniforme"}
              onChange={(value) => void save({ adaptiveRhythm: value === "dinamico" })}
              options={[
                { value: "dinamico", label: "Dinamico" },
                { value: "uniforme", label: "Uniforme" },
              ]}
            />
            <p className="text-sm text-faint">{RHYTHM_HINTS[adaptive ? "dinamico" : "uniforme"]}</p>
          </div>

          <div className="space-y-2">
            <Segmented<PlayMode>
              label="Ao tocar play"
              value={playMode}
              onChange={setPlayMode}
              options={[
                { value: "runner", label: "Word Runner" },
                { value: "guia", label: "Guia na pagina" },
              ]}
            />
            <p className="text-sm text-faint">
              {playMode === "runner"
                ? "Uma palavra por vez no centro da tela, com a frase em volta embaixo."
                : "A palavra atual anda marcada na propria pagina, no mesmo ritmo, e a pagina vira sozinha."}
            </p>
          </div>

          <section className="space-y-4" aria-labelledby="ajustes-aa">
            <h3 id="ajustes-aa" className="text-sm font-semibold">
              Texto
            </h3>
            <Slider
              label="Tamanho da letra"
              display={`${settings.fontScale} de ${MAX_FONT_SCALE}`}
              min={MIN_FONT_SCALE}
              max={MAX_FONT_SCALE}
              value={settings.fontScale}
              onChange={(value) => void save({ fontScale: value })}
            />
            <Segmented<FontFamily>
              label="Fonte"
              value={settings.fontFamily}
              onChange={(value) => void save({ fontFamily: value })}
              options={FONT_FAMILIES.map((family) => ({ value: family, label: FONT_LABELS[family] }))}
            />
            <Slider
              label="Entrelinha"
              display={LINE_HEIGHT_LABELS[settings.lineHeightStep - 1] ?? ""}
              min={MIN_LINE_HEIGHT}
              max={MAX_LINE_HEIGHT}
              value={settings.lineHeightStep}
              onChange={(value) => void save({ lineHeightStep: value })}
            />
            <Segmented<ThemePreference>
              label="Tema"
              value={themePreference}
              onChange={(value) => {
                setThemePreference(value);
                void save({ theme: value });
              }}
              options={[
                { value: "light", label: "Claro", icon: <SunIcon className="size-4" /> },
                { value: "dark", label: "Escuro", icon: <MoonIcon className="size-4" /> },
                { value: "contrast", label: "Contraste", icon: <ContrastIcon className="size-4" /> },
                { value: "system", label: "Sistema", icon: <SettingsIcon className="size-4" /> },
              ]}
            />
          </section>

          <Button
            variant="secondary"
            full
            onClick={() => {
              setShowSettings(false);
              setShortcutsOpen(true);
            }}
          >
            Como usar o leitor
          </Button>

          <Button
            variant="secondary"
            full
            onClick={() => {
              setShowSettings(false);
              // Perder a posicao de um texto longo por um toque errado nao
              // tem volta: acima de 5% pede confirmacao.
              if (total > 0 && index / total > 0.05) {
                setConfirmRestart(true);
              } else {
                restart();
                notify("Leitura reiniciada.");
              }
            }}
          >
            <RestartIcon className="size-5" />
            Comecar do inicio
          </Button>

          {citations > 0 && !text.referencesOmitted ? (
            <Button variant="secondary" full loading={reprocessing} onClick={() => void reprocess("omitir")}>
              {`Omitir referencias do texto (${citations})`}
            </Button>
          ) : null}
          {text.referencesOmitted ? (
            <Button variant="secondary" full loading={reprocessing} onClick={() => void reprocess("restaurar")}>
              Restaurar referencias
            </Button>
          ) : null}

          <Link
            href={`/textos/${text.id}/leituras`}
            className="flex min-h-11 items-center justify-center rounded-full text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
          >
            Historico deste texto
          </Link>
          <Link
            href="/ajustes"
            className="flex min-h-11 items-center justify-center rounded-full text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
          >
            Mais ajustes
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

      <Sheet open={confirmRestart} onClose={() => setConfirmRestart(false)} title="Comecar do inicio?">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {`A leitura esta em ${Math.round((index / total) * 100)}%. Voltar ao inicio troca a posicao salva.`}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setConfirmRestart(false)}>
              Cancelar
            </Button>
            <Button
              size="lg"
              onClick={() => {
                setConfirmRestart(false);
                restart();
                notify("Leitura reiniciada.");
              }}
            >
              Comecar do inicio
            </Button>
          </div>
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

      {/* Fechar (Esc, X, fundo) so fecha: a leitura fica parada e o marco nao
          e dado como respondido. Continuar e o botao. */}
      <Sheet open={checkpoint !== null} onClose={() => setCheckpoint(null)} title="Isso ainda vale?">
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
                  start();
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

const FONT_LABELS: Record<FontFamily, string> = {
  sans: "Sem serifa",
  serif: "Com serifa",
  legivel: "Legivel",
};

const LINE_HEIGHT_LABELS = ["Compacto", "Normal", "Folgado"];

/** "~12 min", "~1 h 5 min" ou "menos de 1 min". */
function formatRemaining(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `~${minutes} min`;
  return `~${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * Dica da velocidade: a faixa (leitura, rapida, varredura) e o ritmo real com
 * as pausas de pontuacao, que fica abaixo do configurado no ritmo Dinamico.
 */
function speedHint(wpm: number, real: number | null): string {
  const band =
    wpm <= 400
      ? "Faixa de leitura."
      : wpm <= 600
        ? "Leitura rapida."
        : "Varredura: acima de ~600 ppm a compreensao costuma cair; faca o teste de compreensao.";
  return real !== null ? `${band} Com as pausas de pontuacao, ~${real} ppm neste texto.` : band;
}

const GESTURES: [string, string][] = [
  ["Play", "Inicia o Word Runner (ou o guia na pagina) da palavra atual"],
  ["Tocar no Word Runner", "Freia: volta a pagina com a palavra atual marcada"],
  ["Tocar numa palavra", "A leitura seguinte comeca dela"],
  ["Tocar na borda ou deslizar", "Vira a pagina"],
  ["Tocar e segurar", "Mostra o significado da palavra"],
  ["Arrastar sobre o texto", "Seleciona para destacar"],
];

const SHORTCUTS: [string, string][] = [
  ["Espaco ou K", "Iniciar ou pausar o Word Runner"],
  ["Seta para cima / baixo", "Mais ou menos 25 ppm"],
  ["Seta para a esquerda / direita", "Pagina anterior ou seguinte; no Word Runner, frase"],
  ["Shift + seta para a esquerda", "Voltar ao inicio da frase"],
  ["D", "Significado da palavra atual"],
  ["H", "Destacar a frase atual"],
  ["/", "Buscar e navegar no texto"],
  ["?", "Esta ajuda"],
  ["Esc", "Fechar a janela aberta"],
];

/**
 * Pausa para descansar a vista (US-104). A contagem regressiva nao retoma a
 * leitura sozinha: quem decide a volta e o leitor.
 */
function EyeRestSheet({
  open,
  onClose,
  onContinue,
}: {
  open: boolean;
  onClose: () => void;
  /** "Continuar" retoma a leitura: e a decisao do leitor, como nas outras folhas. */
  onContinue: () => void;
}) {
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
          <Button size="lg" full onClick={onContinue}>
            Continuar a leitura
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

/** Rotulo do tipo de bloco no Word Runner: o Markdown nao perde a estrutura. */
function blockLabel(block: Paragraph | undefined): string | null {
  switch (block?.kind) {
    case "h1":
    case "h2":
    case "h3":
      return "Titulo";
    case "li":
      return "Item de lista";
    case "oli":
      return block.marker ? `Item ${block.marker}` : "Item de lista";
    case "quote":
      return "Citacao";
    case "code":
      return "Codigo";
    default:
      return null;
  }
}

/** URL e token enorme sem espaco: no Word Runner vale a forma curta. */
function displayToken(word: string): string {
  const url = /^(?:https?:\/\/)?(?:www\.)?([^/\s]+\.[a-z]{2,})(?:[/?#].*)?$/i.exec(word);
  if (url && (word.includes("/") || word.startsWith("http")) && word.length > 25) {
    return `${url[1]}/\u2026`;
  }
  return word;
}

/**
 * Word Runner: uma palavra por vez, parada no centro, com a letra do ponto
 * otimo de reconhecimento alinhada as guias para o olho nao precisar varrer.
 *
 * Embaixo, a frase em volta em letra menor, com a palavra atual em cor cheia:
 * e o contexto que falta ao RSVP puro. A grade fixa (espaco em cima, palavra,
 * contexto embaixo) mantem a palavra no mesmo lugar qualquer que seja o
 * tamanho da frase. Tocar em qualquer ponto freia e devolve a pagina.
 *
 * Para leitor de tela e uma regiao, nao um botao: o botao inteiro escondia a
 * palavra. A palavra nao e anunciada a cada troca (inundaria o leitor); o
 * estado (iniciado, pausado na palavra N) e anunciado pelo leitor.
 */
function RunnerStage({
  words,
  paragraphs,
  index,
  style,
  paragraphStart,
  block,
  language,
  onBrake,
}: {
  words: string[];
  paragraphs: Paragraph[];
  index: number;
  /** Estilo Markdown da palavra; 0 em texto simples. */
  style: number;
  /** A palavra abre um paragrafo novo. */
  paragraphStart: boolean;
  /** Bloco (paragrafo, titulo, item) da palavra atual. */
  block: Paragraph | undefined;
  language: string;
  onBrake: () => void;
}) {
  const current = displayToken(words[index] ?? "");
  const context = runnerContext(words, paragraphs, index, undefined, language);
  const label = blockLabel(block);
  const heading = block?.kind === "h1" || block?.kind === "h2" || block?.kind === "h3";

  return (
    <div
      role="region"
      aria-label="Word Runner"
      aria-roledescription="leitor palavra a palavra"
      data-testid="word-runner"
      onClick={onBrake}
      className="absolute inset-0 z-10 grid cursor-pointer grid-rows-[1fr_auto_1fr] overflow-hidden bg-bg px-4 text-center"
    >
      <div className="flex items-end justify-center pb-2">
        {label ? (
          <span className="text-xs font-medium uppercase tracking-wide text-faint">{label}</span>
        ) : null}
      </div>

      <div className="relative mx-auto w-full max-w-2xl">
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
            {block?.kind === "quote" ? "\u275d" : "\u00b6"}
          </span>
        ) : null}

        <p
          data-testid="palavra-runner"
          className={`runner-word reader-word flex min-h-[4.5rem] items-center justify-center py-6 ${
            style & (STYLE.bold | STYLE.heading) || heading ? "font-extrabold" : "font-semibold"
          } ${block?.kind === "quote" ? "italic" : ""} ${styleClass(style & ~STYLE.bold)}`}
        >
          <OrpWord word={current} />
        </p>
      </div>

      <p aria-hidden="true" className="runner-context reader-prose mx-auto mt-4 w-full max-w-2xl text-balance">
        {context.clippedStart ? "\u2026 " : null}
        {words.slice(context.from, context.to).map((item, offset) => {
          const position = context.from + offset;
          return (
            <Fragment key={position}>
              {offset > 0 ? " " : null}
              <span data-current={position === index ? "" : undefined}>{item}</span>
            </Fragment>
          );
        })}
        {context.clippedEnd ? " \u2026" : null}
      </p>
    </div>
  );
}

/**
 * Alinha a letra de fixacao no centro exato da tela, deslocando o restante da
 * palavra ao redor dela. Precisa de um flex de largura total: em `inline-flex`
 * o container encolhe ate o conteudo, `flex-1` nao tem espaco para distribuir
 * e a letra cai em qualquer posicao.
 *
 * Palavra longa demais para os dois lados caberem com o pivo no centro tem o
 * corpo reduzido so ela (ate 50%): antes "otorrinolaringologista" passava da
 * borda e o pivo saia das guias.
 */
function OrpWord({ word }: { word: string }) {
  // Por code point, nao por unidade UTF-16: letra acentuada nao se parte.
  const parts = orpParts(word);
  const rowRef = useRef<HTMLSpanElement>(null);
  const leftRef = useRef<HTMLSpanElement>(null);
  const pivotRef = useRef<HTMLSpanElement>(null);
  const rightRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const left = leftRef.current;
    const center = pivotRef.current;
    const right = rightRef.current;
    if (!row || !left || !center || !right) return;
    row.style.fontSize = "";
    const available = row.clientWidth / 2;
    const half = center.offsetWidth / 2;
    const needed = Math.max(left.scrollWidth + half, right.scrollWidth + half);
    if (available > 0 && needed > available) {
      const scale = Math.max(0.5, (available * 0.98) / needed);
      row.style.fontSize = `${scale}em`;
    }
  }, [word]);

  return (
    <span ref={rowRef} className="flex w-full items-baseline overflow-hidden" aria-label={word}>
      <span ref={leftRef} aria-hidden="true" className="flex-1 whitespace-pre text-right">
        {parts.before}
      </span>
      <span ref={pivotRef} aria-hidden="true" className="orp">
        {parts.pivot}
      </span>
      <span ref={rightRef} aria-hidden="true" className="flex-1 whitespace-pre text-left">
        {parts.after}
      </span>
    </span>
  );
}

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

  // Palavra com hifen nao quebra no fim da linha (a regua faz o mesmo).
  const joined = isCompound(word) ? <span className="nobreak">{body}</span> : body;
  const classes = styleClass(style);
  return classes ? <span className={classes}>{joined}</span> : <>{joined}</>;
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
  if (!emphasis && !styled && !words.some(isCompound)) return <>{words.join(" ")}</>;

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
 * Palavras de um trecho, com a palavra atual (`current`, indice no texto)
 * envolta numa marca. A marca e so fundo, sem caixa propria: nao muda onde as
 * linhas quebram, entao a pagina continua igual a medida pela regua.
 */
function WordsAt({
  words,
  start,
  current,
  emphasis,
  styles,
}: {
  words: string[];
  start: number;
  current: number | null;
  emphasis: boolean;
  styles?: number[];
}) {
  const at = current === null ? -1 : current - start;
  if (at < 0 || at >= words.length) {
    return <Words words={words} emphasis={emphasis} styles={styles} />;
  }

  return (
    <>
      {at > 0 ? (
        <>
          <Words words={words.slice(0, at)} emphasis={emphasis} styles={styles?.slice(0, at)} />{" "}
        </>
      ) : null}
      <span className="current-word" data-testid="palavra-atual">
        <Word word={words[at]!} emphasis={emphasis} style={styles?.[at]} />
      </span>
      {at < words.length - 1 ? (
        <>
          {" "}
          <Words
            words={words.slice(at + 1)}
            emphasis={emphasis}
            styles={styles?.slice(at + 1)}
          />
        </>
      ) : null}
    </>
  );
}

/**
 * Atributos do paragrafo que dizem, ao CSS, o tipo do bloco Markdown e se o
 * trecho continua um paragrafo iniciado antes (sem recuo de primeira linha).
 */
function blockProps(paragraph: Paragraph) {
  const level =
    paragraph.kind === "h1" ? 1 : paragraph.kind === "h2" ? 2 : paragraph.kind === "h3" ? 3 : 0;
  return {
    ...(paragraph.kind && paragraph.kind !== "p"
      ? { "data-kind": paragraph.kind, "data-marker": paragraph.marker }
      : {}),
    // Titulo e titulo tambem para leitor de tela; o elemento continua <p>,
    // que e o que a regua de paginacao mede.
    ...(level > 0 && !paragraph.continued
      ? { role: "heading" as const, "aria-level": level + 1 }
      : {}),
    ...(paragraph.continued ? { "data-cont": "" } : {}),
  };
}

/** Os quatro manipuladores de ponteiro que o toque longo precisa. */
type WordTouchHandlers = ReturnType<typeof useWordTouch>["handlers"];

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
  current,
  onOpenMark,
}: {
  paragraph: Paragraph;
  marks: StoredHighlight[];
  emphasis: boolean;
  /** Palavra atual, marcada na pagina; null sem marca. */
  current: number | null;
  onOpenMark: (id: string) => void;
}) {
  const end = paragraph.start + paragraph.words.length;
  const segments = segmentsOf(paragraph.start, end, marks);

  if (segments.length === 1 && segments[0]!.id === null) {
    return (
      <span data-start={paragraph.start}>
        <WordsAt
          words={paragraph.words}
          start={paragraph.start}
          current={current}
          emphasis={emphasis}
          styles={paragraph.styles}
        />
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
              <WordsAt
                words={words}
                start={segment.start}
                current={current}
                emphasis={emphasis}
                styles={styles}
              />
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
              // Destaque existente abre com teclado tambem, nao so com ponteiro.
              role="button"
              tabIndex={0}
              aria-label={`Destaque${segment.hasNote ? " com nota" : ""}: ${words.join(" ").slice(0, 80)}`}
              onClick={(event) => {
                // O toque no destaque e dele: nao muda a posicao de leitura.
                event.stopPropagation();
                onOpenMark(segment.id!);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenMark(segment.id!);
                }
              }}
            >
              <WordsAt
                words={words}
                start={segment.start}
                current={current}
                emphasis={emphasis}
                styles={styles}
              />
            </span>
            {gap}
          </span>
        );
      })}
    </>
  );
}

/**
 * Pagina: uma tela cheia de texto por vez, sem rolagem.
 *
 * O frame define a altura disponivel e a regua oculta mede, com a mesma
 * largura e tipografia, quantas palavras cabem nela.
 *
 * O toque e decidido pelo ponto, sem botoes transparentes por cima do texto:
 * nas bordas estreitas vira a pagina (o gesto de um e-reader); no resto,
 * tocar numa palavra faz a leitura comecar dela. Antes, zonas de 25% de cada
 * lado cobriam 40% das palavras e bloqueavam toque longo, selecao e o toque
 * para posicionar.
 *
 * Memoizada: enquanto o Word Runner roda ela fica escondida e nao pode
 * re-renderizar a cada palavra.
 */
const PageStage = memo(function PageStage({
  frameRef,
  rulerRef,
  paragraphs,
  pageStart,
  pageEnd,
  ready,
  loadingMore,
  marks,
  emphasis,
  current,
  hidden,
  touch,
  onTurn,
  onTap,
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
  current: number | null;
  /** Coberta pelo Word Runner: continua montada para a paginacao seguir medida. */
  hidden: boolean;
  touch: WordTouchHandlers;
  onTurn: (direction: 1 | -1) => void;
  /** Toque na pagina: a palavra tocada (ou null) e a borda (-1, 0, 1). */
  onTap: (position: number | null, edge: -1 | 0 | 1) => void;
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

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // Arrastar para selecionar nao e toque.
    if (!window.getSelection()?.isCollapsed) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / Math.max(1, box.width);
    const edge = x < EDGE_FRACTION ? -1 : x > 1 - EDGE_FRACTION ? 1 : 0;
    onTap(edge === 0 ? wordIndexFromPoint(event.clientX, event.clientY) : null, edge);
  };

  return (
    <div
      className={`relative flex min-h-0 flex-1 flex-col px-5 py-6${hidden ? " invisible" : ""}`}
      aria-hidden={hidden || undefined}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onClick={onClick}
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
                    current={current}
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
    </div>
  );
});

const SWIPE_THRESHOLD_PX = 45;

function Finished({
  total,
  summary,
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
  summary: Summary | null;
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
  // Sessao curta demais (um toque, a ultima pagina) nao da numero que preste:
  // "1 palavras a 3000 ppm" confundia mais do que informava.
  const measurable =
    summary !== null && summary.wordsRead >= MIN_WORDS_TO_RECORD && summary.wallMs >= 5_000;
  const realWpm = measurable ? Math.round(summary.wordsRead / (summary.wallMs / 60_000)) : 0;
  const columns = (measurable ? 3 : 0) + (comprehension !== null ? 1 : 0);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-positive-soft text-positive">
        <CheckIcon className="size-8" />
      </div>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Leitura concluida</h2>
        <p className="mt-1 text-muted">
          {`${formatNumber(total)} ${total === 1 ? "palavra" : "palavras"}`}
        </p>
      </div>

      {measurable || comprehension !== null ? (
        <Card
          className={`grid w-full max-w-md divide-x divide-border ${
            columns >= 4 ? "grid-cols-4" : columns === 3 ? "grid-cols-3" : "grid-cols-1"
          }`}
        >
          {measurable ? (
            <>
              <div className="p-3">
                <p className="tabular text-2xl font-semibold">{realWpm}</p>
                <p className="text-sm text-muted">ppm reais</p>
              </div>
              <div className="p-3">
                <p className="tabular text-2xl font-semibold">{summary.configuredWpm}</p>
                <p className="text-sm text-muted">configurado</p>
              </div>
              <div className="p-3">
                <p className="tabular text-2xl font-semibold">{formatClock(summary.wallMs)}</p>
                <p className="text-sm text-muted">tempo</p>
              </div>
            </>
          ) : null}
          {comprehension !== null ? (
            <div className="p-3">
              <p className="tabular text-2xl font-semibold">{comprehension}%</p>
              <p className="text-sm text-muted">acertos</p>
            </div>
          ) : null}
        </Card>
      ) : null}
      {measurable ? (
        <p className="-mt-3 max-w-sm text-xs text-faint">
          O ritmo real inclui as pausas de pontuacao; o historico e o treino usam o ritmo das palavras.
        </p>
      ) : null}

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
