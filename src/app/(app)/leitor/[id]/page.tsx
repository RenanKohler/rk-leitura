"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useResource } from "@/hooks/use-resource";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { pageOfWord, usePagedText } from "@/hooks/use-paged-text";
import { useSettings, useToast } from "@/components/providers";
import { Button, Card, Segmented, Sheet, Skeleton, Slider } from "@/components/ui";
import {
  BackIcon,
  CheckIcon,
  FastForwardIcon,
  PauseIcon,
  PlayIcon,
  ForwardIcon,
  RestartIcon,
  RewindIcon,
  SettingsIcon,
} from "@/components/icons";
import {
  chunkDurationMs,
  clamp,
  formatClock,
  formatNumber,
  MAX_CHUNK,
  MAX_WPM,
  MIN_CHUNK,
  MIN_WPM,
  orpIndex,
  tokenize,
  type ReadingMode,
} from "@/lib/reading";
import type { TextDetail } from "@/lib/types";

export const MODE_HINTS: Record<ReadingMode, string> = {
  rsvp: "Uma palavra por vez no centro da tela, com a letra de fixacao destacada.",
  flow: "Texto corrido com rolagem, destacando o trecho atual.",
  page: "Uma tela cheia por vez, sem rolagem. Toque na metade direita para avancar e na esquerda para voltar.",
};

const MIN_WORDS_TO_RECORD = 10;
const PROGRESS_SAVE_INTERVAL_MS = 5_000;
/** Salto de "uma tela" nos modos que nao tem pagina medida. */
const SCREENFUL_WORDS = 110;

export default function ReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const resource = useResource<{ text: TextDetail }>(`/api/texts/${id}`);

  if (resource.loading) {
    return (
      <div className="min-h-dvh flex flex-col gap-6 p-6">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="flex-1 rounded-card" />
      </div>
    );
  }

  if (resource.error || !resource.data) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Texto nao encontrado</h1>
        <p className="text-muted">Ele pode ter sido removido.</p>
        <Link
          href="/textos"
          className="inline-flex min-h-12 items-center rounded-full bg-accent px-6 font-medium text-accent-ink"
        >
          Voltar para a biblioteca
        </Link>
      </div>
    );
  }

  return <Reader text={resource.data.text} />;
}

function Reader({ text }: { text: TextDetail }) {
  const { settings, save } = useSettings();
  const notify = useToast();

  const words = useMemo(() => tokenize(text.content), [text.content]);
  const total = words.length;

  const [index, setIndex] = useState(() => clamp(text.progressIndex, 0, Math.max(0, total - 1)));
  const [playing, setPlaying] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [finished, setFinished] = useState(false);

  const wpm = settings.baseWpm;
  const chunkSize = settings.wordsPerChunk;
  const mode = settings.readingMode;

  useWakeLock(playing);

  // As referencias so sao preenchidas quando o modo Paginas esta montado; nos
  // outros modos o observer nunca liga e `pages` fica no valor inicial.
  const { frameRef, rulerRef, pages, ready: pagesReady } = usePagedText(words);
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
    // A versao anterior dividia a duracao pelo tamanho do bloco em vez de
    // multiplicar: em 350 ppm com 4 palavras o texto passava a ~5600 ppm.
    const delay =
      mode === "page"
        ? (60_000 / wpm) * step
        : chunkDurationMs(wpm, chunkSize) * pauseFactor(chunk);

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
  }, [playing, index, chunkSize, wpm, total, words, mode, pageEnd, saveProgress, flushSession]);

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
  const stateRef = useRef({ index, playing });

  useEffect(() => {
    stateRef.current = { index, playing };
  }, [index, playing]);

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
      saveProgress(stateRef.current.index);
      setPlaying(false);
      return;
    }

    if (stateRef.current.index >= total) return;
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

  /** Vira a pagina no modo Paginas; nos outros, anda uma tela de texto. */
  const turnPage = useCallback(
    (direction: 1 | -1) => {
      setFinished(false);
      setIndex((current) => {
        if (mode === "page") {
          const page = pageOfWord(pages, current);
          const target = pages[page + direction];
          if (target === undefined) {
            return direction === 1 ? Math.max(0, total - 1) : 0;
          }
          return target;
        }
        return clamp(current + direction * SCREENFUL_WORDS, 0, Math.max(0, total - 1));
      });
    },
    [mode, pages, total]
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
    <div className="min-h-dvh flex flex-col bg-bg">
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
          />
        ) : mode === "rsvp" ? (
          <RsvpStage chunk={chunk} onToggle={togglePlay} playing={playing} />
        ) : mode === "page" ? (
          <PageStage
            frameRef={frameRef}
            rulerRef={rulerRef}
            words={words}
            pageStart={pageStart}
            pageEnd={pageEnd}
            ready={pagesReady}
            onTurn={turnPage}
          />
        ) : (
          <FlowStage
            words={words}
            index={index}
            chunkSize={chunkSize}
            onToggle={togglePlay}
            onSeek={(position) => {
              setIndex(position);
              setFinished(false);
            }}
          />
        )}
      </main>

      {!finished ? (
        <footer className="pb-safe sticky bottom-0 border-t border-border bg-bg/95 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl px-4 py-3">
            <div className="flex items-center justify-center gap-3">
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
function PageStage({
  frameRef,
  rulerRef,
  words,
  pageStart,
  pageEnd,
  ready,
  onTurn,
}: {
  frameRef: React.RefObject<HTMLDivElement | null>;
  rulerRef: React.RefObject<HTMLDivElement | null>;
  words: string[];
  pageStart: number;
  pageEnd: number;
  ready: boolean;
  onTurn: (direction: 1 | -1) => void;
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
        <p className="text-lg leading-[1.85] sm:text-xl">
          {ready ? words.slice(pageStart, pageEnd).join(" ") : ""}
        </p>

        {/* Regua: fora da arvore visivel, mesma largura e tipografia. */}
        <div
          ref={rulerRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute inset-x-0 top-0 text-lg leading-[1.85] sm:text-xl"
        />
      </div>

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
  words,
  index,
  chunkSize,
  onToggle,
  onSeek,
}: {
  words: string[];
  index: number;
  chunkSize: number;
  onToggle: () => void;
  onSeek: (position: number) => void;
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
  const end = Math.min(words.length, index + reach);
  const visible = words.slice(start, end);

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
      <p className="mx-auto max-w-2xl text-lg leading-[1.9] sm:text-xl">
        {visible.map((word, offset) => {
          const position = start + offset;
          const state =
            position >= index && position < index + chunkSize
              ? "active"
              : position < index
                ? "read"
                : "pending";

          return (
            <span
              key={position}
              ref={position === index ? activeRef : undefined}
              data-state={state}
              className="flow-word cursor-pointer"
              onClick={() => onSeek(position)}
            >
              {word}{" "}
            </span>
          );
        })}
      </p>
      {end < words.length ? (
        <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      ) : null}

      <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-faint">
        {end < words.length
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
}: {
  total: number;
  durationMs: number;
  wordsRead: number;
  onRestart: () => void;
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

      <Card className="grid w-full max-w-sm grid-cols-2 divide-x divide-border">
        <div className="p-4">
          <p className="tabular text-2xl font-semibold">{wpm > 0 ? wpm : "--"}</p>
          <p className="text-sm text-muted">ppm</p>
        </div>
        <div className="p-4">
          <p className="tabular text-2xl font-semibold">{formatClock(durationMs)}</p>
          <p className="text-sm text-muted">tempo</p>
        </div>
      </Card>

      <div className="flex w-full max-w-sm flex-col gap-2">
        <Button size="lg" full onClick={onRestart}>
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
