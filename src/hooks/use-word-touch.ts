"use client";

import { useCallback, useRef, useState } from "react";
import { sentenceAround, wordAround } from "@/lib/dictionary";

/** Tempo de toque que separa "consultar" de "tocar para seguir". */
const LONG_PRESS_MS = 450;

/** Movimento acima disso e rolagem ou selecao, nao toque longo. */
const MOVE_TOLERANCE_PX = 10;

export interface TouchedWord {
  word: string;
  context: string;
}

/**
 * Toque longo sobre uma palavra do texto.
 *
 * A palavra e encontrada pela posicao do dedo, nao por um elemento proprio:
 * o texto no DOM continua sendo um no de texto so, e a quebra de pagina fica
 * identica a de hoje - que e justamente o criterio de risco da US-38.
 */
export function useWordTouch(enabled: boolean): {
  touched: TouchedWord | null;
  clear: () => void;
  open: (word: TouchedWord) => void;
  handlers: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerCancel: () => void;
  };
} {
  const [touched, setTouched] = useState<TouchedWord | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled) return;
      cancel();
      origin.current = { x: event.clientX, y: event.clientY };
      const { clientX, clientY } = event;

      timer.current = setTimeout(() => {
        const found = wordAtPoint(clientX, clientY);
        if (found) {
          // O toque longo do sistema abriria a selecao por cima do painel.
          window.getSelection()?.removeAllRanges();
          setTouched(found);
        }
      }, LONG_PRESS_MS);
    },
    [enabled, cancel]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const moved =
        Math.abs(event.clientX - origin.current.x) > MOVE_TOLERANCE_PX ||
        Math.abs(event.clientY - origin.current.y) > MOVE_TOLERANCE_PX;
      if (moved) cancel();
    },
    [cancel]
  );

  return {
    touched,
    clear: useCallback(() => setTouched(null), []),
    // O modo Foco abre o painel sem toque longo: la a palavra ja esta
    // escolhida pela posicao da leitura.
    open: useCallback((chosen: TouchedWord) => setTouched(chosen), []),
    handlers: {
      onPointerDown,
      onPointerUp: cancel,
      onPointerMove,
      onPointerCancel: cancel,
    },
  };
}

/** Palavra sob o ponto da tela, com a frase em volta. */
function wordAtPoint(x: number, y: number): TouchedWord | null {
  const position = caretAt(x, y);
  if (!position) return null;

  const text = position.node.textContent ?? "";
  const word = wordAround(text, position.offset);
  if (!word) return null;

  return { word, context: sentenceAround(text, position.offset) };
}

/** `caretPositionFromPoint` com o nome antigo do WebKit como reserva. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const target = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const position = target.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };

  const range = target.caretRangeFromPoint?.(x, y);
  if (range) return { node: range.startContainer, offset: range.startOffset };

  return null;
}
