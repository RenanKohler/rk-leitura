/**
 * Pausas de pontuacao do Word Runner, em milissegundos.
 *
 * Modulo sem dependencias: `reading.ts` usa o acrescimo medio das pausas na
 * estimativa de minutos e `pacing.ts` usa a pausa de cada palavra; se isto
 * morasse em `pacing.ts`, `reading.ts` e `pacing.ts` importariam um ao outro.
 * `pacing.ts` reexporta tudo, entao quem usa o ritmo importa de la.
 */

export type PauseKind = "none" | "clause" | "sentence" | "paragraph";

/** Pausa, em ms, a 300 ppm (200 ms por palavra): o ponto de ancoragem. */
export const PAUSE_AT_300: Record<Exclude<PauseKind, "none">, number> = {
  clause: 160,
  sentence: 360,
  paragraph: 520,
};

/**
 * Expoente da lei de potencia. Abaixo de 1, a pausa cresce menos que a
 * duracao da palavra: devagar ela nao vira um buraco (o "gaguejar" do Word
 * Runner lento) e rapido ela nao some. Substitui o piso e o teto em ms, que
 * deixavam a pausa constante nas pontas - a 100 e a 150 ppm o fim de frase
 * era o mesmo, a 900 e a 1200 tambem.
 */
export const PAUSE_EXPONENT = 0.8;
/** Teto de seguranca: nenhuma pausa passa disso, em ritmo algum. */
export const PAUSE_MAX_MS = 1500;

/** Milissegundos de pausa na velocidade dada: P300 * (duracao / 200)^0,8. */
export function pauseMs(kind: PauseKind, wpm: number): number {
  if (kind === "none") return 0;
  const perWord = 60_000 / Math.max(wpm, 1);
  const pause = PAUSE_AT_300[kind] * Math.pow(perWord / 200, PAUSE_EXPONENT);
  return Math.round(Math.min(PAUSE_MAX_MS, pause));
}

/**
 * Frequencia media de cada pausa por palavra, medida nos textos de exemplo
 * (`src/db/seed.ts`): prosa expositiva em portugues, paragrafos de 30 a 60
 * palavras. Da ~1,17 a 300 ppm, a menos de 1% da soma real nesses textos.
 * Serve so quando nao ha o texto para medir de verdade.
 */
export const PAUSE_RATES: Record<Exclude<PauseKind, "none">, number> = {
  clause: 0.051,
  sentence: 0.038,
  paragraph: 0.024,
};

/**
 * Fator medio de acrescimo das pausas no tempo de relogio, para quando so se
 * conhece a contagem de palavras (lista de textos, fila, Ajustes).
 *
 * O ppm das sessoes gravadas desconta as pausas, entao multiplicar o tempo
 * "limpo" (palavras / ppm) por este fator da o tempo que a tela vai levar.
 * Cresce um pouco em ritmo alto: a pausa encolhe menos que a palavra.
 */
export function pauseOverhead(wpm: number): number {
  const perWord = 60_000 / Math.max(wpm, 1);
  let extra = 0;
  for (const kind of ["clause", "sentence", "paragraph"] as const) {
    extra += PAUSE_RATES[kind] * pauseMs(kind, wpm);
  }
  return 1 + extra / perWord;
}

/** O acrescimo no ritmo padrao de 300 ppm. */
export const PAUSE_OVERHEAD = pauseOverhead(300);
