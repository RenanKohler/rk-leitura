"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { pageOfWord, usePagedText } from "@/hooks/use-paged-text";
import { useSettings, useToast } from "@/components/providers";
import { Button, Card, Segmented, Sheet, Slider, Spinner } from "@/components/ui";
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
  SettingsIcon,
  SparkIcon,
} from "@/components/icons";
import {
  chunkDurationMs,
  clamp,
  typographyVars,
  warmupFactor,
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
  type Paragraph,
  type ReadingMode,
} from "@/lib/reading";
import { apiSend } from "@/lib/client";
import { QuizSheet } from "@/components/quiz-sheet";
import { HighlightSheet } from "@/components/highlight-sheet";
import { MIN_WORDS_FOR_QUIZ } from "@/lib/quiz";
import { useWordSelection } from "@/hooks/use-word-selection";
import {
  markCovering,
  segmentsOf,
  sentenceRange,
  type Span,
  type StoredHighlight,
} from "@/lib/highlights";
import type { ContinuationResult, HighlightItem, NextUp, TextDetail } from "@/lib/types";

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

export function ReaderClient({
  text,
  highlights,
  startAt,
  nextUp,
}: {
  text: TextDetail;
  highlights: HighlightItem[];
  startAt?: number;
  nextUp: NextUp | null;
}) {
  return (
    <Reader
      key={text.id}
      text={text}
      highlights={highlights}
      startAt={startAt}
      nextUp={nextUp}
    />
  );
}

function Reader({
  text: initialText,
  highlights,
  startAt,
  nextUp,
}: {
  text: TextDetail;
  highlights: HighlightItem[];
  startAt?: number;
  nextUp: NextUp | null;
}) {
  const { settings, save } = useSettings();
  const notify = useToast();

  // Em estado porque a busca da proxima parte faz o texto crescer durante a
  // leitura, sem recarregar a tela.
  const [text, setText] = useState(initialText);
  const [loadingMore, setLoadingMore] = useState(false);

  // As duas visoes do mesmo texto: a lista corrida indexa a posicao, os
  // paragrafos dao a forma na tela.
  const { words, paragraphs } = useMemo(() => parseParagraphs(text.content), [text.content]);
  const total = words.length;

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

  const wpm = settings.baseWpm;
  const chunkSize = settings.wordsPerChunk;
  const mode = settings.readingMode;
  const warmup = settings.warmup;

  useWakeLock(playing);

  // As referencias so sao preenchidas quando o modo Paginas esta montado; nos
  // outros modos o observer nunca liga e `pages` fica no valor inicial.
  const { frameRef, rulerRef, pages, ready: pagesReady } = usePagedText(paragraphs, total);
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
  }, [nextUp, text.id, router, notify]);

  /** Destaca a frase que contem a palavra atual, sem parar a leitura. */
  const markSentence = useCallback(() => {
    const range = sentenceRange(words, index);
    if (range) void createMark(range);
  }, [words, index, createMark]);

  const elapsedMs = useCallback(
    () => elapsedRef.current + (startedAtRef.current ? Date.now() - startedAtRef.current : 0),
    []
  );

  const saveProgress = useCallback(
    (position: number, useKeepalive = false) => {
      if (position === savedIndexRef.current) return;
      savedIndexRef.current = position;
      void fetch(`/api/texts/${text.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progressIndex: position }),
        keepalive: useKeepalive,
      }).catch(() => undefined);
    },
    [text.id]
  );

  /** Grava a sessao e zera os acumuladores. Devolve o que foi contabilizado. */
  const flushSession = useCallback(
    (completed: boolean, useKeepalive = false) => {
      const duration = elapsedMs();
      const wordsRead = wordsReadRef.current;

      elapsedRef.current = 0;
      startedAtRef.current = null;
      wordsReadRef.current = 0;

      if (wordsRead < MIN_WORDS_TO_RECORD || duration < 1000) {
        return { durationMs: duration, wordsRead };
      }

      void fetch("/api/reading-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          textId: text.id,
          wordsRead,
          durationMs: duration,
          completed,
        }),
        keepalive: useKeepalive,
      }).catch(() => undefined);

      return { durationMs: duration, wordsRead };
    },
    [text.id, elapsedMs]
  );

  /* --- motor de avanco --------------------------------------------------- */
  useEffect(() => {
    if (!playing) return;

    // Ja no fim: nada a agendar. A conclusao e tratada no callback abaixo.
    if (index >= total) return;

    // No modo Paginas o passo e a pagina inteira: o tempo de permanencia
    // corresponde as palavras que ainda faltam nela.
    const step = mode === "page" ? Math.max(1, pageEnd - index) : chunkSize;
    const chunk = words.slice(index, index + step);

    // A rampa vale para o ritmo palavra a palavra. No modo Paginas a tela
    // inteira ja da tempo de sobra para o olho se ajustar.
    const factor =
      warmup && mode !== "page" ? warmupFactor(index - warmupOriginRef.current) : 1;

    // A versao anterior dividia a duracao pelo tamanho do bloco em vez de
    // multiplicar: em 350 ppm com 4 palavras o texto passava a ~5600 ppm.
    const delay =
      mode === "page"
        ? (60_000 / wpm) * step
        : chunkDurationMs(wpm, chunkSize, factor) * pauseFactor(chunk);

    const timer = setTimeout(() => {
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
    mode,
    pageEnd,
    warmup,
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
  const togglePlay = useCallback(() => {
    if (stateRef.current.playing) {
      elapsedRef.current += startedAtRef.current ? Date.now() - startedAtRef.current : 0;
      startedAtRef.current = null;
      pausedAtRef.current = Date.now();
      saveProgress(stateRef.current.index);
      setPlaying(false);
      return;
    }

    if (stateRef.current.index >= total) return;

    // Pausa curta nao reinicia a rampa. O numero e o que separa "parei para
    // ajustar a tela" de "voltei ao texto depois de um tempo".
    const brief = Date.now() - pausedAtRef.current < SHORT_PAUSE_MS;
    if (!brief) warmupOriginRef.current = stateRef.current.index;

    startedAtRef.current = Date.now();
    setFinished(false);
    setPlaying(true);
  }, [total, saveProgress]);

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
  }, [loadingMore, notify]);

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

  const restart = useCallback(() => {
    setPlaying(false);
    setFinished(false);
    setSummary(null);
    setIndex(0);
    saveProgress(0);
  }, [saveProgress]);

  /* --- teclado (desktop) -------------------------------------------------- */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
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
  }, [togglePlay, turnPage]);

  const progress = total > 0 ? Math.min(100, (index / total) * 100) : 0;
  const chunk = words.slice(index, index + chunkSize);

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
        {finished ? (
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
          <RsvpStage chunk={chunk} onToggle={togglePlay} playing={playing} />
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
            onTurn={turnPage}
            onOpenMark={setOpenMark}
          />
        ) : (
          <FlowStage
            paragraphs={paragraphs}
            totalWords={total}
            index={index}
            chunkSize={chunkSize}
            marks={stored}
            onToggle={togglePlay}
            onSeek={(position) => {
              setIndex(position);
              setFinished(false);
            }}
            onOpenMark={setOpenMark}
          />
        )}
      </main>

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

      {!finished ? (
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

      {openMark && marks.some((item) => item.id === openMark) ? (
        <HighlightSheet
          key={openMark}
          mark={marks.find((item) => item.id === openMark)!}
          onClose={() => setOpenMark(null)}
          onSaveNote={(note) => saveNote(openMark, note)}
          onRemove={() => removeMark(openMark)}
        />
      ) : null}

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
        </div>
      </Sheet>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-12 items-center justify-center rounded-full border border-border text-muted transition-colors hover:text-ink active:scale-95"
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
  playing,
  onToggle,
}: {
  chunk: string[];
  playing: boolean;
  onToggle: () => void;
}) {
  const single = chunk.length === 1 ? chunk[0] : null;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={playing ? "Pausar" : "Iniciar leitura"}
      className="flex flex-1 flex-col items-center justify-center px-4 text-center"
    >
      <div className="relative w-full max-w-2xl">
        <div className="absolute inset-x-0 top-0 flex justify-center">
          <span className="h-3 w-px bg-accent/40" />
        </div>
        <div className="absolute inset-x-0 bottom-0 flex justify-center">
          <span className="h-3 w-px bg-accent/40" />
        </div>

        <p className="reader-word flex min-h-[4.5rem] items-center justify-center py-6 text-[clamp(2rem,11vw,4rem)] font-semibold">
          {single ? <OrpWord word={single} /> : <span>{chunk.join(" ")}</span>}
        </p>
      </div>

      {!playing ? (
        <span className="mt-6 text-sm text-faint">Toque para comecar</span>
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
  onOpenMark,
}: {
  paragraph: Paragraph;
  marks: StoredHighlight[];
  onOpenMark: (id: string) => void;
}) {
  const end = paragraph.start + paragraph.words.length;
  const segments = segmentsOf(paragraph.start, end, marks);

  if (segments.length === 1 && segments[0]!.id === null) {
    return <span data-start={paragraph.start}>{paragraph.words.join(" ")}</span>;
  }

  return (
    <>
      {segments.map((segment, position) => {
        const from = segment.start - paragraph.start;
        const words = paragraph.words.slice(from, segment.end - paragraph.start).join(" ");
        // O espaco entre pedacos vive fora deles: dentro, entraria na contagem
        // de palavras do pedaco seguinte e deslocaria a selecao em um.
        const gap = segment.end < end ? " " : "";

        if (!segment.id) {
          return (
            <span key={position} data-start={segment.start}>
              {words}
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
              {words}
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
                <p key={paragraph.start}>
                  <MarkedText paragraph={paragraph} marks={marks} onOpenMark={onOpenMark} />
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
  onToggle,
  onSeek,
  onOpenMark,
}: {
  paragraphs: Paragraph[];
  totalWords: number;
  index: number;
  chunkSize: number;
  marks: StoredHighlight[];
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

  const start = Math.max(0, index - WINDOW_BEFORE);
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
    <div className="flex-1 px-5 py-8" onDoubleClick={onToggle}>
      <div className="reader-prose mx-auto max-w-2xl">
        {visible.map((paragraph) => (
          <p key={paragraph.start}>
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
                  {word}{" "}
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
 * Pontuacao e palavras longas ganham um respiro extra: sem isso o fim de frase
 * passa no mesmo ritmo do meio dela e a compreensao cai.
 */
function pauseFactor(chunk: string[]): number {
  if (chunk.length === 0) return 1;
  const last = chunk[chunk.length - 1]!;
  const longest = Math.max(...chunk.map((word) => word.length));

  let factor = 1;
  if (/[.!?]["')\]]?$/.test(last)) factor += 0.6;
  else if (/[,;:]["')\]]?$/.test(last)) factor += 0.3;
  if (longest > 12) factor += 0.25;

  return factor;
}
