/**
 * Regras de ritmo e tempo das epicas de retomada, desistencia, tempo livre e
 * ritmo adaptativo (US-77 a US-88).
 *
 * Todas puras: o leitor, as rotas e os testes chamam as mesmas funcoes, entao
 * a previsao mostrada na tela e a que a tela executa.
 */
import { MAX_WPM, MIN_WPM, WARMUP_WORDS, warmupFactor, type Paragraph } from "@/lib/reading";

/* --- ritmo real (US-83) ---------------------------------------------------- */

/** Sessoes consideradas: as mais recentes, ate este numero. */
export const PACE_SAMPLE = 10;
/** Minimo de sessoes validas para a estimativa usar o historico. */
export const PACE_MIN_SESSIONS = 3;
/** Sessao curta demais mede mais o tempo de abrir o texto que o de ler. */
export const PACE_MIN_WORDS = 200;
export const PACE_WINDOW_DAYS = 30;
/** Abaixo disso a sessao foi quase toda pausa. */
export const PACE_MIN_WPM = 50;

export interface PaceSample {
  wpm: number;
  wordsRead: number;
  narrated: boolean;
  createdAt: Date;
}

export interface Pace {
  wpm: number;
  /** Verdadeiro quando nao ha historico e o valor e a velocidade configurada. */
  fromSettings: boolean;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/**
 * Ritmo real: a mediana das sessoes recentes validas.
 *
 * O `wpm` da sessao ja e o medido - o servidor o calcula de palavras e
 * duracao. Ficam de fora a narracao (o ritmo e o da voz), sessoes curtas,
 * quase paradas ou no teto que o servidor aplica (sinal de medida quebrada).
 */
export function effectiveWpm(samples: PaceSample[], baseWpm: number, now = new Date()): Pace {
  const since = now.getTime() - PACE_WINDOW_DAYS * 86_400_000;
  const valid = samples
    .filter(
      (sample) =>
        !sample.narrated &&
        sample.wordsRead >= PACE_MIN_WORDS &&
        sample.wpm >= PACE_MIN_WPM &&
        sample.wpm < MAX_WPM &&
        sample.createdAt.getTime() >= since
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, PACE_SAMPLE);

  if (valid.length < PACE_MIN_SESSIONS) {
    return { wpm: Math.min(Math.max(baseWpm, MIN_WPM), MAX_WPM), fromSettings: true };
  }
  return { wpm: median(valid.map((sample) => sample.wpm)), fromSettings: false };
}

/* --- previsao de tempo (US-84, US-85) ------------------------------------- */

/**
 * Milissegundos para ler `words` palavras no ritmo dado, com a rampa de
 * aquecimento do inicio quando ela esta ligada. O ritmo adaptativo nao entra
 * na conta: ele redistribui o tempo sem mudar a media.
 */
export function predictMs(words: number, wpm: number, warmup: boolean): number {
  const perWord = 60_000 / Math.max(wpm, 1);
  if (!warmup) return words * perWord;

  let total = 0;
  const ramp = Math.min(words, WARMUP_WORDS);
  for (let index = 0; index < ramp; index += 1) total += perWord / warmupFactor(index);
  return total + Math.max(0, words - ramp) * perWord;
}

/**
 * Fim do ultimo paragrafo que cabe no tempo, a partir da posicao `from`.
 *
 * Devolve null quando nem o paragrafo atual cabe: um trecho que termina no
 * meio de uma frase nao serve como sugestao (US-84, criterio 3).
 */
export function fitParagraphEnd(
  paragraphs: Paragraph[],
  from: number,
  budgetMs: number,
  wpm: number,
  warmup: boolean
): { end: number; predictedMs: number } | null {
  let best: { end: number; predictedMs: number } | null = null;

  for (const paragraph of paragraphs) {
    const end = paragraph.start + paragraph.words.length;
    if (end <= from) continue;

    const predicted = predictMs(end - from, wpm, warmup);
    if (predicted > budgetMs) break;
    best = { end, predictedMs: predicted };
  }

  return best;
}

/* --- recapitulacao (US-77, US-78) ----------------------------------------- */

export const RECAP_WORDS = 40;
export const RECAP_AFTER_MS = 48 * 60 * 60 * 1000;
export const RECAP_MAX_HIGHLIGHTS = 5;

const SENTENCE_END = /[.!?]["')\]]?$/;

/**
 * Trecho a recapitular ao retomar um texto parado (US-77), ou null.
 *
 * So depois de 48 horas sem leitura, alem da palavra 40, e nunca quando o
 * texto foi aberto numa posicao escolhida (`?de=`). O trecho comeca no inicio
 * da frase, para nao abrir no meio de uma oracao.
 */
export function recapWindow(
  words: string[],
  position: number,
  lastReadAt: Date | null,
  now: Date,
  chosenStart: boolean
): { from: number; to: number } | null {
  if (chosenStart || !lastReadAt || position <= RECAP_WORDS) return null;
  if (now.getTime() - lastReadAt.getTime() < RECAP_AFTER_MS) return null;

  let from = Math.max(0, position - RECAP_WORDS);
  while (from > 0 && !SENTENCE_END.test(words[from - 1] ?? "")) from -= 1;
  return { from, to: position };
}

/** Destaques antes da posicao, os mais proximos dela, em ordem de leitura (US-78). */
export function highlightsBefore<T extends { start: number; end: number }>(
  marks: T[],
  position: number
): T[] {
  return marks
    .filter((mark) => mark.end <= position)
    .sort((a, b) => a.start - b.start)
    .slice(-RECAP_MAX_HIGHLIGHTS);
}

/* --- desistencia (US-80, US-82) ------------------------------------------- */

export const CHECKPOINTS = [25, 50, 75] as const;
/** Texto curto nao pergunta: largar um texto de 3 minutos nao economiza nada. */
export const CHECKPOINT_MIN_WORDS = 800;
export const STALE_QUEUE_DAYS = 30;

/**
 * Marco atravessado agora que ainda nao foi respondido, ou null.
 *
 * `answered` e o maior marco ja respondido: pular dois de uma vez pergunta so
 * pelo maior, que e o que descreve onde a leitura esta.
 */
export function checkpointCrossed(
  position: number,
  total: number,
  answered: number
): number | null {
  if (total < CHECKPOINT_MIN_WORDS) return null;
  const percent = (position / total) * 100;
  const crossed = CHECKPOINTS.filter((marker) => percent >= marker && marker > answered);
  return crossed.length > 0 ? crossed[crossed.length - 1]! : null;
}

/** Minutos economizados ao largar, pelo ritmo informado. */
export function savedMinutes(wordsLeft: number, wpm: number): number {
  return wpm > 0 ? Math.round(wordsLeft / wpm) : 0;
}

/* --- ritmo adaptativo (US-87, US-88) -------------------------------------- */

/** Peso extra das palavras que o leitor ja consultou no dicionario. */
export const KNOWN_WORD_BOOST = 1.5;

const DIGIT = /\d/;
const STRIP = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * Peso de uma palavra: quanto tempo ela pede em relacao a media.
 *
 * Curta passa mais rapido; longa, numero e nome proprio ficam mais. O fim de
 * frase e de oracao ganha a pausa que o leitor ja tinha. So regras locais,
 * sem modelo de linguagem.
 */
export function wordWeight(word: string, previous: string | undefined): number {
  const bare = word.replace(STRIP, "");
  const length = bare.length;

  let weight = length <= 3 ? 0.75 : length <= 8 ? 1 : length <= 12 ? 1.15 : 1.3;
  if (DIGIT.test(bare)) weight += 0.35;
  // Maiuscula no meio da frase e nome proprio; no comeco, e so a frase.
  const sentenceStart = previous === undefined || SENTENCE_END.test(previous);
  if (!sentenceStart && /^\p{Lu}/u.test(bare)) weight += 0.25;

  if (SENTENCE_END.test(word)) weight += 0.6;
  else if (/[,;:]["')\]]?$/.test(word)) weight += 0.3;

  return weight;
}

/** Forma usada para reconhecer uma palavra ja consultada. */
export function wordKeyForPace(word: string): string {
  return word
    .replace(STRIP, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Quanto do peso bruto vira variacao de tempo. Com o peso inteiro, palavras
 * curtas passavam 25% mais rapido que o ppm escolhido e a leitura parecia
 * nao seguir a velocidade; 40% mantem a pausa de pontuacao perceptivel sem
 * acelerar o resto.
 */
export const ADAPTIVE_STRENGTH = 0.4;

/** Nenhuma palavra passa mais de 5% mais rapido que o ppm configurado. */
export const ADAPTIVE_FLOOR = 0.95;

/**
 * Pesos de todas as palavras, normalizados para a media do texto.
 *
 * A normalizacao mantem a velocidade media perto da configurada (US-87,
 * criterio 3): o tempo e redistribuido, nao acrescentado. O piso impede que a
 * redistribuicao acelere palavras curtas alem do ppm escolhido; com ele a
 * media fica ate 5% abaixo, nunca acima.
 *
 * As palavras ja consultadas (US-88) ganham o acrescimo por ultimo, sobre o
 * peso final, para os 50% nao serem diluidos pela atenuacao.
 */
export function normalizedWeights(words: string[], known: ReadonlySet<string> = new Set()): number[] {
  const softened = words.map(
    (word, index) => 1 + ADAPTIVE_STRENGTH * (wordWeight(word, words[index - 1]) - 1)
  );
  const mean = softened.reduce((sum, weight) => sum + weight, 0) / Math.max(softened.length, 1);

  return softened.map((weight, index) => {
    const base = Math.max(ADAPTIVE_FLOOR, mean > 0 ? weight / mean : 1);
    return known.size > 0 && known.has(wordKeyForPace(words[index]!))
      ? base * KNOWN_WORD_BOOST
      : base;
  });
}

/** Fator de duracao de um bloco: a media dos pesos de todas as suas palavras. */
export function chunkFactor(weights: number[], from: number, size: number): number {
  const slice = weights.slice(from, from + size);
  if (slice.length === 0) return 1;
  return slice.reduce((sum, weight) => sum + weight, 0) / slice.length;
}
