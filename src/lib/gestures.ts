/**
 * Classificacao dos gestos de ponteiro na area de leitura (US-210).
 *
 * Modulo puro: recebe as medidas de um gesto ja terminado e diz o que ele foi.
 * Quem le os eventos e o `useReaderGestures`; quem decide o que fazer com um
 * toque ou um deslize e o leitor. Os limiares ficam aqui, num lugar so, para o
 * toque longo do dicionario (`useWordTouch`) e os gestos nao divergirem.
 */

/** Tempo parado que separa "consultar" de "tocar para seguir". */
export const LONG_PRESS_MS = 450;

/** Movimento acima disso deixa de ser toque (e cancela o toque longo). */
export const MOVE_TOLERANCE_PX = 10;

/** Distancia horizontal minima de um deslize. */
export const SWIPE_MIN_PX = 60;

/** Um arraste mais demorado que isso nao e deslize. */
export const SWIPE_MAX_MS = 1000;

/**
 * Faixa em cada borda lateral da tela onde o deslize e do sistema: no Android
 * o gesto de "voltar" comeca ali.
 */
export const EDGE_GUARD_PX = 24;

export type Gesture = "toque" | "deslize-esquerda" | "deslize-direita";

export interface GestureSample {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Do toque ao soltar. */
  durationMs: number;
  /**
   * Quanto o ponteiro ficou parado antes de passar de `MOVE_TOLERANCE_PX`;
   * nulo se nunca passou.
   */
  stillMs: number | null;
  /** Largura da tela, para a faixa das bordas. */
  viewportWidth: number;
}

/**
 * Diz o que o gesto foi, ou null quando ele nao e dos gestos do leitor
 * (toque longo, arraste vertical, arraste curto, deslize a partir da borda).
 */
export function classifyGesture(sample: GestureSample): Gesture | null {
  const { startX, startY, endX, endY, durationMs, stillMs, viewportWidth } = sample;

  if (stillMs === null) {
    // Parado ate soltar: toque, a menos que tenha durado o bastante para o
    // toque longo, que e do dicionario.
    return durationMs < LONG_PRESS_MS ? "toque" : null;
  }

  // O toque longo ja disparou antes de o dedo andar: o que vem depois e
  // selecao de texto ou o painel da palavra, nao deslize.
  if (stillMs >= LONG_PRESS_MS) return null;
  if (durationMs > SWIPE_MAX_MS) return null;
  if (startX < EDGE_GUARD_PX || startX > viewportWidth - EDGE_GUARD_PX) return null;

  const deltaX = endX - startX;
  const deltaY = endY - startY;
  if (Math.abs(deltaX) < SWIPE_MIN_PX) return null;
  if (Math.abs(deltaY) >= Math.abs(deltaX)) return null;

  return deltaX < 0 ? "deslize-esquerda" : "deslize-direita";
}

/** O ponteiro saiu da tolerancia de toque em relacao ao ponto inicial. */
export function movedPastTolerance(
  startX: number,
  startY: number,
  x: number,
  y: number
): boolean {
  return (
    Math.abs(x - startX) > MOVE_TOLERANCE_PX || Math.abs(y - startY) > MOVE_TOLERANCE_PX
  );
}
