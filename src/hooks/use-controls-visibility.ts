"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Tempo parado na pagina, sem tocar nos controles, ate eles sairem da tela. */
export const CONTROLS_IDLE_MS = 4_000;

/**
 * Cabecalho e rodape do leitor saem da tela durante a leitura (US-213).
 *
 * - Lendo (Word Runner ou guia na pagina): escondidos.
 * - Pagina parada: escondidos depois de `CONTROLS_IDLE_MS` sem interacao.
 * - `hold` (folha aberta, aviso na tela) ou foco dentro dos controles:
 *   sempre visiveis.
 *
 * `reveal` traz os controles de volta e reinicia a contagem; o leitor chama
 * ao pausar e ao tocar fora de palavra. `focusHandlers` vai no cabecalho e no
 * rodape: com teclado ou leitor de tela, o foco dentro deles os mantem na tela.
 */
export function useControlsVisibility({
  enabled,
  playing,
  hold,
}: {
  enabled: boolean;
  playing: boolean;
  hold: boolean;
}): {
  hidden: boolean;
  reveal: () => void;
  /** Esconde agora, sem esperar a contagem (botao de tela cheia). */
  hideNow: () => void;
  focusHandlers: {
    onFocus: (event: React.FocusEvent) => void;
    onBlur: (event: React.FocusEvent) => void;
    onPointerDown: () => void;
  };
} {
  const [idle, setIdle] = useState(false);
  const [focused, setFocused] = useState(false);
  // Muda a cada interacao: reinicia a contagem do efeito.
  const [activity, setActivity] = useState(0);

  const reveal = useCallback(() => {
    setIdle(false);
    setActivity((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled || playing || hold || focused) return;
    const timer = setTimeout(() => setIdle(true), CONTROLS_IDLE_MS);
    return () => clearTimeout(timer);
  }, [enabled, playing, hold, focused, activity]);

  // A pausa sempre devolve os controles: o leitor pode estar procurando o play.
  const wasPlaying = useRef(playing);
  useEffect(() => {
    if (wasPlaying.current && !playing) reveal();
    wasPlaying.current = playing;
  }, [playing, reveal]);

  // So o foco de teclado (ou de leitor de tela) segura os controles: o toque
  // no play tambem foca o botao, e os controles nunca sairiam da tela.
  const onFocus = useCallback(
    (event: React.FocusEvent) => {
      const target = event.target as Element;
      if (typeof target.matches === "function" && !target.matches(":focus-visible")) return;
      setFocused(true);
      reveal();
    },
    [reveal]
  );
  const onBlur = useCallback((event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setFocused(false);
  }, []);

  const hideNow = useCallback(() => {
    // O botao que pediu a tela cheia ficaria com o foco e seguraria os
    // controles na tela.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setFocused(false);
    setIdle(true);
  }, []);

  const hidden = enabled && !hold && !focused && (playing || idle);
  return { hidden, reveal, hideNow, focusHandlers: { onFocus, onBlur, onPointerDown: reveal } };
}
