"use client";

import { useCallback, useMemo, useRef } from "react";
import { classifyGesture, movedPastTolerance, type Gesture } from "@/lib/gestures";

export interface GesturePoint {
  x: number;
  y: number;
}

export interface ReaderGestureHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: (event: React.PointerEvent) => void;
}

interface Tracking {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  /** Quando o ponteiro passou da tolerancia de toque; nulo enquanto parado. */
  movedAt: number | null;
}

/**
 * Gestos da area de leitura (US-210): recebe os eventos de ponteiro e avisa,
 * ao soltar, se foi toque, deslize para a esquerda ou deslize para a direita.
 * A regra esta em `classifyGesture`; aqui so se acompanha o ponteiro.
 *
 * O hook e passivo: nao chama `preventDefault`, nao captura o ponteiro e nao
 * interrompe a propagacao. Por isso convive com o `useWordTouch` no mesmo
 * elemento - os dois leem os mesmos eventos, e um toque longo nunca chega
 * aqui como gesto. Como os dois devolvem `onPointer*`, quem usa os dois junta
 * os tratadores em vez de espalhar um por cima do outro.
 *
 * Para o navegador entregar o deslize horizontal como evento de ponteiro (e
 * nao cancelar para rolar), a area precisa de `touch-action: pan-y`.
 *
 * `onGesture` deve ser estavel (`useCallback`): os tratadores devolvidos so
 * mudam quando ele muda, e a pagina do leitor e memoizada.
 */
export function useReaderGestures(
  onGesture: (gesture: Gesture, start: GesturePoint) => void,
  enabled = true
): { handlers: ReaderGestureHandlers } {
  const tracking = useRef<Tracking | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Segundo dedo na tela e pinca ou toque acidental: nao ha gesto. Um
      // ponteiro principal novo recomeca do zero, mesmo que o anterior tenha
      // ficado sem o evento de soltar.
      if (!enabled || !event.isPrimary) {
        tracking.current = null;
        return;
      }
      tracking.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: event.timeStamp,
        movedAt: null,
      };
    },
    [enabled]
  );

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const current = tracking.current;
    if (!current || current.pointerId !== event.pointerId || current.movedAt !== null) return;
    if (movedPastTolerance(current.startX, current.startY, event.clientX, event.clientY)) {
      current.movedAt = event.timeStamp;
    }
  }, []);

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const current = tracking.current;
      if (!current || current.pointerId !== event.pointerId) return;
      tracking.current = null;

      // O mouse arrasta para selecionar texto; deslize e so de dedo e caneta.
      const dragged =
        current.movedAt !== null ||
        movedPastTolerance(current.startX, current.startY, event.clientX, event.clientY);
      if (dragged && event.pointerType === "mouse") return;
      // Arrastar depois do toque longo seleciona texto: nao e gesto.
      if (dragged && !window.getSelection()?.isCollapsed) return;

      const gesture = classifyGesture({
        startX: current.startX,
        startY: current.startY,
        endX: event.clientX,
        endY: event.clientY,
        durationMs: event.timeStamp - current.startedAt,
        stillMs: dragged ? (current.movedAt ?? event.timeStamp) - current.startedAt : null,
        viewportWidth: window.innerWidth,
      });
      if (gesture) onGesture(gesture, { x: current.startX, y: current.startY });
    },
    [onGesture]
  );

  const onPointerCancel = useCallback(() => {
    tracking.current = null;
  }, []);

  const handlers = useMemo(
    () => ({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel]
  );

  return { handlers };
}
