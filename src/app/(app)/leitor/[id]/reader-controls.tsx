"use client";

import Link from "next/link";
import { Sheet } from "@/components/ui";
import {
  BackIcon,
  FastForwardIcon,
  ForwardIcon,
  MarkIcon,
  MoreIcon,
  FullscreenIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon,
  SearchIcon,
  SettingsIcon,
  SparkIcon,
  SpeedIcon,
  StudyIcon,
  PagesIcon,
  VoiceIcon,
} from "@/components/icons";

/*
 * Barra de controles do leitor (US-210), fora do motor de leitura.
 *
 * So apresentacao: o estado (posicao, velocidade, modo do play) e as acoes
 * continuam no leitor e chegam por props. Mudar a barra nao reabre o Word
 * Runner nem a paginacao.
 */

export type PlayMode = "runner" | "guia";

export const PLAY_MODE_LABELS: Record<PlayMode, string> = {
  runner: "Word Runner",
  guia: "Guia na página",
};

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

export interface ReaderControlBarProps {
  playing: boolean;
  narrating: boolean;
  playButtonRef: React.Ref<HTMLButtonElement>;
  onTogglePlay: () => void;
  onToggleSpeech: () => void;
  onBackSentence: () => void;
  onForwardSentence: () => void;
  onTurnPage: (direction: 1 | -1) => void;
  onMarkSentence: () => void;
  wpm: number;
  speedOpen: boolean;
  onToggleSpeed: () => void;
  playMode: PlayMode;
  onTogglePlayMode: () => void;
  onOpenMore: () => void;
  /** Tela cheia agora, sem esperar os 4 s; ausente quando a opcao esta desligada. */
  onFullscreen?: () => void;
  /** Texto da linha de estado: pagina, trecho ou ritmo real. */
  status: string;
}

/**
 * Grade fixa: parado e correndo tem os mesmos lugares, e o play nao sai do
 * centro, onde o polegar o procura. Embaixo, velocidade, estado, modo do play
 * (US-214) e o "Mais" com as acoes do texto (US-215). Tudo com area de toque
 * de pelo menos 48 x 48 px.
 */
export function ReaderControlBar({
  playing,
  narrating,
  playButtonRef,
  onTogglePlay,
  onToggleSpeech,
  onBackSentence,
  onForwardSentence,
  onTurnPage,
  onMarkSentence,
  wpm,
  speedOpen,
  onToggleSpeed,
  playMode,
  onTogglePlayMode,
  onOpenMore,
  onFullscreen,
  status,
}: ReaderControlBarProps) {
  return (
    <div className="reader-bar mx-auto w-full max-w-3xl px-4 py-2">
      <div className="reader-bar-main grid grid-cols-5 items-center justify-items-center">
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
          className="reader-play flex size-16 items-center justify-center rounded-full bg-accent text-accent-ink shadow-float transition-transform active:scale-95"
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

      <div className="reader-bar-row mt-1 flex min-h-12 items-center justify-between gap-2 text-sm">
        <button
          type="button"
          onClick={onToggleSpeed}
          aria-expanded={speedOpen}
          aria-label={`Velocidade: ${wpm} ppm`}
          className={`tabular min-h-12 shrink-0 rounded-full border px-3 font-medium ${
            speedOpen ? "border-accent text-accent" : "border-border text-muted"
          }`}
        >
          {`${wpm} ppm`}
        </button>
        <p className="reader-bar-status tabular min-w-0 flex-1 truncate text-right text-muted">
          {status}
        </p>
        <button
          type="button"
          onClick={onTogglePlayMode}
          aria-label={`Modo do play: ${PLAY_MODE_LABELS[playMode]}. Trocar para ${
            PLAY_MODE_LABELS[playMode === "runner" ? "guia" : "runner"]
          }`}
          data-testid="modo-play"
          data-mode={playMode}
          className="flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border px-3 font-medium text-muted hover:text-ink"
        >
          {playMode === "runner" ? (
            <SpeedIcon className="size-5" />
          ) : (
            <PagesIcon className="size-5" />
          )}
          {/* Em tela estreita fica so o icone: o rotulo acessivel diz o modo. */}
          <span className="hidden min-[400px]:inline">{playMode === "runner" ? "Runner" : "Guia"}</span>
        </button>
        {onFullscreen ? (
          <ControlButton label="Tela cheia" onClick={onFullscreen}>
            <FullscreenIcon className="size-5" />
          </ControlButton>
        ) : null}
        <ControlButton label="Mais ações" onClick={onOpenMore}>
          <MoreIcon className="size-5" />
        </ControlButton>
      </div>
    </div>
  );
}

/**
 * Acoes sobre o texto, perto do polegar (US-215): as mesmas do cabecalho,
 * que no celular fica so com Voltar e o progresso.
 */
export function MoreActionsSheet({
  open,
  onClose,
  textId,
  marksCount,
  onAsk,
  onNavigate,
  onSettings,
}: {
  open: boolean;
  onClose: () => void;
  textId: string;
  marksCount: number;
  onAsk: () => void;
  onNavigate: () => void;
  onSettings: () => void;
}) {
  const item =
    "flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left font-medium hover:bg-surface-2";
  // Abre a folha seguinte so depois de fechar esta: duas folhas abertas
  // disputariam o foco.
  const then = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Mais ações">
      <nav aria-label="Ações do texto" className="space-y-1" data-testid="mais-acoes">
        {marksCount > 0 ? (
          <Link href={`/textos/${textId}/destaques`} className={item}>
            <MarkIcon className="size-5 text-muted" />
            {`Destaques (${marksCount})`}
          </Link>
        ) : null}
        <button type="button" className={item} onClick={then(onAsk)}>
          <SparkIcon className="size-5 text-muted" />
          Perguntar ao texto
        </button>
        <Link href={`/textos/${textId}/estudar`} className={item}>
          <StudyIcon className="size-5 text-muted" />
          Estudar
        </Link>
        <button type="button" className={item} onClick={then(onNavigate)}>
          <SearchIcon className="size-5 text-muted" />
          Navegar no texto
        </button>
        <button type="button" className={item} onClick={then(onSettings)}>
          <SettingsIcon className="size-5 text-muted" />
          Ajustes de leitura
        </button>
      </nav>
    </Sheet>
  );
}
