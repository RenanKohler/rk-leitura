"use client";

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import {
  classifyGesture,
  isHorizontalDrag,
  startsAtEdge,
  type GestureKind,
  type GesturePoint,
} from "@/lib/gestures";

/** Depois de um deslize, o clique que o navegador ainda manda nao e toque. */
const AFTER_GESTURE_MS = 400;

export interface ReaderGestureOptions {
  /** Desligado, os handlers nao fazem nada. */
  enabled: boolean;
  /**
   * O gesto nao conta agora: selecao de texto em andamento, toque longo que
   * abriu o dicionario. Consultado no inicio e no fim do gesto.
   */
  blocked?: () => boolean;
  /** Deslize terminado: -1 para a esquerda, 1 para a direita. */
  onSwipe?: (direction: -1 | 1) => void;
  /** Inicio de um arraste horizontal valido (fora da borda). */
  onDragStart?: () => void;
  /** Arraste horizontal em andamento, com o deslocamento desde o inicio. */
  onDrag?: (dx: number) => void;
}

export interface ReaderGestureHandlers {
  onTouchStart: (event: React.TouchEvent) => void;
  onTouchMove: (event: React.TouchEvent) => void;
  onTouchEnd: (event: React.TouchEvent) => void;
  onTouchCancel: () => void;
}

/**
 * Gestos da area de leitura (US-210): toque e deslize, ja classificados.
 *
 * Usa eventos de toque, nao de ponteiro: o navegador cancela o ponteiro
 * quando decide rolar, e o deslize se perderia no meio. Os handlers de
 * ponteiro do `useWordTouch` (toque longo) seguem no mesmo elemento sem
 * disputa - este hook nao chama `preventDefault`.
 */
export function useReaderGestures(options: ReaderGestureOptions): {
  handlers: ReaderGestureHandlers;
  /** Houve um deslize ou arraste ha pouco: o clique que vem junto nao e toque. */
  recentGesture: () => boolean;
} {
  // As opcoes mudam a cada render; os handlers ficam estaveis e leem a ultima.
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const start = useRef<GesturePoint | null>(null);
  const dragging = useRef(false);
  const gestureAt = useRef(0);

  const reset = useCallback(() => {
    start.current = null;
    dragging.current = false;
  }, []);

  const onTouchStart = useCallback((event: React.TouchEvent) => {
    const current = optionsRef.current;
    if (!current.enabled || event.touches.length !== 1) {
      start.current = null;
      return;
    }
    const touch = event.touches[0]!;
    start.current = { x: touch.clientX, y: touch.clientY };
    dragging.current = false;
  }, []);

  const onTouchMove = useCallback((event: React.TouchEvent) => {
    const origin = start.current;
    const current = optionsRef.current;
    if (!origin || !current.enabled) return;
    if (event.touches.length !== 1) {
      start.current = null;
      return;
    }
    const touch = event.touches[0]!;
    const point = { x: touch.clientX, y: touch.clientY };
    if (!dragging.current) {
      if (startsAtEdge(origin.x, window.innerWidth)) return;
      if (!isHorizontalDrag(origin, point)) return;
      if (current.blocked?.()) {
        start.current = null;
        return;
      }
      dragging.current = true;
      current.onDragStart?.();
    }
    gestureAt.current = Date.now();
    current.onDrag?.(point.x - origin.x);
  }, []);

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const origin = start.current;
      const current = optionsRef.current;
      const wasDragging = dragging.current;
      reset();
      if (!origin || !current.enabled) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      // O navegador agrupa os `touchmove`: o ultimo trecho do arraste pode
      // chegar so no fim do toque.
      if (wasDragging) current.onDrag?.(touch.clientX - origin.x);
      const kind: GestureKind = classifyGesture(
        origin,
        { x: touch.clientX, y: touch.clientY },
        window.innerWidth
      );
      if (kind === "tap") return;
      gestureAt.current = Date.now();
      if (kind === "none" || current.blocked?.()) return;
      // Um arraste de velocidade tambem e deslize, mas quem o usa nao vira
      // pagina: so recebe o deslize quem pediu.
      if (wasDragging && current.onDrag && !current.onSwipe) return;
      current.onSwipe?.(kind === "swipe-left" ? -1 : 1);
    },
    [reset]
  );

  const recentGesture = useCallback(() => Date.now() - gestureAt.current < AFTER_GESTURE_MS, []);

  const handlers = useMemo(
    () => ({ onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: reset }),
    [onTouchStart, onTouchMove, onTouchEnd, reset]
  );

  return { handlers, recentGesture };
}
