/**
 * Gestos do leitor no celular (US-210 a US-212).
 *
 * Funcoes puras: o hook de gestos so junta os pontos do dedo e pergunta aqui
 * o que o movimento foi. Assim os limiares ficam testados sem navegador.
 */

import { clamp, MAX_WPM, MIN_WPM } from "@/lib/reading";

/** Deslocamento horizontal minimo para virar a pagina. */
export const SWIPE_MIN_PX = 60;

/**
 * Faixa de cada borda lateral reservada ao gesto de voltar do Android: um
 * deslize que comeca nela e do sistema, nao do leitor.
 */
export const EDGE_GUARD_PX = 24;

/** Ate aqui de movimento, o toque continua sendo toque (freio, palavra). */
export const TAP_MAX_MOVE_PX = 10;

/** Distancia de deslize por passo de velocidade no Word Runner. */
export const SPEED_STEP_PX = 40;

/** Passo de velocidade: o mesmo das setas do teclado. */
export const SPEED_STEP_WPM = 25;

export interface GesturePoint {
  x: number;
  y: number;
}

export type GestureKind = "tap" | "swipe-left" | "swipe-right" | "none";

/** O dedo pousou na faixa da borda reservada ao sistema. */
export function startsAtEdge(x: number, viewportWidth: number): boolean {
  return x < EDGE_GUARD_PX || x > viewportWidth - EDGE_GUARD_PX;
}

/** Movimento predominantemente horizontal, alem da tolerancia do toque. */
export function isHorizontalDrag(start: GesturePoint, current: GesturePoint): boolean {
  const dx = Math.abs(current.x - start.x);
  const dy = Math.abs(current.y - start.y);
  return dx > TAP_MAX_MOVE_PX && dy < dx;
}

/**
 * Classifica um gesto terminado.
 *
 * - Movimento dentro da tolerancia e toque, onde quer que tenha comecado: o
 *   toque na borda continua virando a pagina e o toque no Word Runner
 *   continua sendo o freio.
 * - Deslize que comeca na borda e do sistema e nao vale nada aqui.
 * - Deslize so conta com pelo menos `SWIPE_MIN_PX` na horizontal e menos
 *   deslocamento na vertical do que na horizontal.
 */
export function classifyGesture(
  start: GesturePoint,
  end: GesturePoint,
  viewportWidth: number
): GestureKind {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) <= TAP_MAX_MOVE_PX && Math.abs(dy) <= TAP_MAX_MOVE_PX) return "tap";
  if (startsAtEdge(start.x, viewportWidth)) return "none";
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dy) >= Math.abs(dx)) return "none";
  return dx < 0 ? "swipe-left" : "swipe-right";
}

/** Passos de velocidade inteiros percorridos num deslize (negativo para a esquerda). */
export function speedSteps(dx: number): number {
  return Math.trunc(dx / SPEED_STEP_PX);
}

/**
 * Velocidade durante um deslize no Word Runner: a base do inicio do gesto
 * mais 25 ppm a cada 40 px, dentro dos limites do leitor.
 */
export function speedFromDrag(baseWpm: number, dx: number): number {
  return clamp(baseWpm + speedSteps(dx) * SPEED_STEP_WPM, MIN_WPM, MAX_WPM);
}
