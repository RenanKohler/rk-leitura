"use client";

import { useLayoutEffect, useRef } from "react";
import { Slider } from "@/components/ui";
import {
  BackIcon,
  FastForwardIcon,
  ForwardIcon,
  MarkIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon,
  VoiceIcon,
} from "@/components/icons";
import { MAX_WPM, MIN_WPM } from "@/lib/reading";
import { speedHint } from "@/lib/speed-bands";

/*
 * Rodape do leitor (US-210): a barra de controles e o lugar dos avisos que
 * flutuam acima dela. O motor (Word Runner, paginacao, narracao) fica no
 * `reader-client`; aqui so entram o estado ja resolvido e as acoes.
 */

export function ReaderControls({
  playing,
  narrating,
  wpm,
  realWpm,
  pageStatus,
  speedOpen,
  playButtonRef,
  onToggleSpeed,
  onSpeedChange,
  onTogglePlay,
  onToggleSpeech,
  onBackSentence,
  onForwardSentence,
  onTurnPage,
  onMarkSentence,
  children,
}: {
  playing: boolean;
  narrating: boolean;
  wpm: number;
  /** Ritmo real com as pausas de pontuacao; nulo fora do ritmo Dinamico. */
  realWpm: number | null;
  /** Linha da pagina, mostrada com a leitura parada. */
  pageStatus: string;
  speedOpen: boolean;
  /** O foco volta para o play quando o Word Runner e freado pelo toque. */
  playButtonRef: React.Ref<HTMLButtonElement>;
  onToggleSpeed: () => void;
  onSpeedChange: (wpm: number) => void;
  onTogglePlay: () => void;
  onToggleSpeech: () => void;
  onBackSentence: () => void;
  onForwardSentence: () => void;
  onTurnPage: (direction: 1 | -1) => void;
  onMarkSentence: () => void;
  /** Avisos do leitor, empilhados acima da barra. */
  children?: React.ReactNode;
}) {
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
  }, []);

  return (
    <footer
      ref={footerRef}
      className="pb-safe relative z-20 shrink-0 border-t border-border bg-bg/95 backdrop-blur"
    >
      {/* Tudo o que aparece por cima (avisos, barra de selecao, voltar ao
          lugar) flutua acima do rodape, fora do fluxo: entrar ou sair nao
          muda a altura do quadro nem refaz as paginas. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-full flex flex-col items-center gap-2 px-4 pb-2">
        {children}

        {speedOpen ? (
          <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-border bg-surface p-4 shadow-float">
            <Slider
              label="Velocidade"
              display={`${wpm} ppm`}
              min={MIN_WPM}
              max={MAX_WPM}
              step={10}
              hint={speedHint(wpm, realWpm)}
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
              label={narrating ? "Parar a narração" : "Ler em voz alta"}
              onClick={onToggleSpeech}
              active={narrating}
            >
              <VoiceIcon className="size-5" />
            </ControlButton>
          ) : (
            <span aria-hidden="true" className="size-12" />
          )}

          {playing ? (
            <ControlButton label="Voltar a frase" onClick={onBackSentence}>
              <RewindIcon className="size-5" />
            </ControlButton>
          ) : (
            <ControlButton label="Página anterior" onClick={() => onTurnPage(-1)}>
              <BackIcon className="size-5" />
            </ControlButton>
          )}

          <button
            ref={playButtonRef}
            type="button"
            onClick={onTogglePlay}
            aria-label={playing ? "Pausar" : "Iniciar leitura"}
            className="flex size-16 items-center justify-center rounded-full bg-accent text-accent-ink shadow-float transition-transform active:scale-95"
          >
            {playing ? <PauseIcon className="size-7" /> : <PlayIcon className="size-7" />}
          </button>

          {playing ? (
            <ControlButton label="Avançar a frase" onClick={onForwardSentence}>
              <FastForwardIcon className="size-5" />
            </ControlButton>
          ) : (
            <ControlButton label="Próxima página" onClick={() => onTurnPage(1)}>
              <ForwardIcon className="size-5" />
            </ControlButton>
          )}

          <ControlButton label="Destacar frase" onClick={onMarkSentence}>
            <MarkIcon className="size-5" />
          </ControlButton>
        </div>

        <div className="mt-1 flex min-h-11 items-center justify-between gap-2 text-sm">
          <button
            type="button"
            onClick={onToggleSpeed}
            aria-expanded={speedOpen}
            aria-label={`Velocidade: ${wpm} ppm`}
            className={`tabular min-h-11 shrink-0 rounded-full border px-3 font-medium ${
              speedOpen ? "border-accent text-accent" : "border-border text-muted"
            }`}
          >
            {`${wpm} ppm`}
          </button>
          <p className="tabular min-w-0 flex-1 truncate text-right text-muted">
            {playing ? (realWpm !== null ? `~${realWpm} ppm reais` : `${wpm} ppm`) : pageStatus}
          </p>
        </div>
      </div>
    </footer>
  );
}

export function ControlButton({
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
