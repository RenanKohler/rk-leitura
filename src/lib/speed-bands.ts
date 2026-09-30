/**
 * Faixas de velocidade (PROD-8).
 *
 * O slider de velocidade vai ate numeros em que ja nao se le de verdade: acima
 * de ~600 ppm a compreensao costuma cair, e o que se faz e varrer o texto. A
 * faixa da nome ao que o numero significa, em Ajustes e no leitor, para quem
 * escolhe 900 ppm saber que escolheu varrer.
 *
 * Modulo puro e sem dependencias, para o leitor importar sem arrastar nada.
 */

export type SpeedBand = "leitura" | "rapida" | "varredura";

/** Ate este ritmo (inclusive) e leitura comum. */
export const READING_MAX_WPM = 400;
/** Ate este ritmo (inclusive) e leitura rapida; acima, varredura. */
export const FAST_MAX_WPM = 600;

export function speedBand(wpm: number): SpeedBand {
  if (wpm <= READING_MAX_WPM) return "leitura";
  if (wpm <= FAST_MAX_WPM) return "rapida";
  return "varredura";
}

export const SPEED_BAND_LABELS: Record<SpeedBand, string> = {
  leitura: "leitura",
  rapida: "leitura rapida",
  varredura: "varredura",
};

/** Aviso mostrado na faixa de varredura; nulo nas outras. */
export function speedBandWarning(wpm: number): string | null {
  return speedBand(wpm) === "varredura"
    ? "Acima de ~600 ppm a compreensao costuma cair; faca o teste de compreensao."
    : null;
}
