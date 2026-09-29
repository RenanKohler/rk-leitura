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

/* --- ritmo dinamico (US-87, US-88) --------------------------------------- */
/*
 * Modelo do Word Runner do Kindle ("Dynamic Pacing") e dos leitores RSVP de
 * codigo aberto (Spritz, Squirt, speedread): o tempo de cada palavra tem duas
 * partes independentes.
 *
 * 1. Peso lexical: palavra longa, numero e nome proprio ficam mais; palavra
 *    curta, um pouco menos. Normalizado para a media do texto, entao so
 *    redistribui o tempo - a velocidade media das palavras continua a
 *    escolhida.
 * 2. Pausa de pontuacao: um respiro depois de virgula, fim de frase e fim de
 *    paragrafo, somado ao tempo da palavra. E o que da o fraseado: a frase
 *    chega como unidade, em vez de uma fila de palavras no mesmo passo.
 *
 * A versao anterior misturava as duas coisas num peso so, atenuado a 40% e
 * normalizado: o fim de frase ganhava ~15% e a virgula ~7% - imperceptivel,
 * e a leitura soava como metronomo. Os leitores de referencia usam de 2x a 3x
 * da duracao da palavra nessas posicoes.
 *
 * As pausas sao proporcionais a duracao da palavra, mas presas entre um piso
 * e um teto em milissegundos. Sem o teto, em ritmo lento a pausa de 3x passa
 * de um segundo e a leitura "gagueja" (a critica mais comum ao Word Runner em
 * velocidade baixa); sem o piso, em ritmo alto ela some.
 */

/** Descricao das duas opcoes de ritmo, na folha do leitor e nos Ajustes. */
export const RHYTHM_HINTS = {
  dinamico:
    "Como o Word Runner do Kindle: pausa curta na virgula, maior no fim da frase e do paragrafo; palavras longas, numeros e nomes ficam um pouco mais.",
  uniforme: "Toda palavra fica o mesmo tempo, sem pausas de pontuacao.",
} as const;

export type PauseKind = "none" | "clause" | "sentence" | "paragraph";

/** Pausa extra, em duracoes de palavra, com piso e teto em ms. */
export const PAUSES: Record<Exclude<PauseKind, "none">, { factor: number; min: number; max: number }> =
  {
    clause: { factor: 0.8, min: 70, max: 240 },
    sentence: { factor: 1.8, min: 160, max: 480 },
    paragraph: { factor: 2.6, min: 260, max: 700 },
  };

// Fecha aspas, parenteses e colchetes depois da pontuacao: `fim."` e `(sic),`.
const SENTENCE_MARK = /[.!?\u2026]["'\u201d\u2019\u00bb)\]]*$/u;
const CLAUSE_MARK = /(?:[,;:]|\))["'\u201d\u2019\u00bb)\]]*$/u;
const DASH = /^[\u2013\u2014-]+$/;

/** Tratamentos: vem antes de um nome e nao pedem pausa nenhuma ("Sr. Silva"). */
const TITLES = new Set([
  "sr", "sra", "srta", "srs", "sras", "dr", "dra", "drs", "dras", "prof", "profa", "profs",
  "sto", "sta", "mr", "mrs", "mme", "exmo", "exma", "revmo",
]);

/**
 * Abreviaturas que terminam em ponto sem terminar a frase (pt e en). A
 * comparacao e sem acento e em minusculas. Palavras comuns que tambem sao
 * abreviatura ("no", "min") ficam de fora: la o ponto encerra a frase.
 */
const ABBREVIATIONS = new Set([
  "av", "pag", "pags", "pp", "cap", "caps", "ex", "fig", "figs", "vol", "vols", "ed",
  "eds", "obs", "cf", "vs", "cit", "ibid", "et", "al", "aprox", "tel", "dept", "depto",
  "ltda", "cia", "e.g", "i.e", "etc", "art", "arts", "inc", "num", "sec", "seg",
]);

function bareLower(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[.\u2026"'\u201d\u2019\u00bb)\]]+$/u, "");
}

/**
 * Que pausa vem depois da palavra `index`.
 *
 * Fim de paragrafo vale mais que fim de frase, que vale mais que virgula. O
 * ponto de tratamento ("Sr."), de abreviatura ("etc.", "cap.") e de inicial
 * de nome ("J.") nao encerra a frase; um ponto seguido de minuscula tambem
 * nao.
 */
export function pauseAfter(
  words: string[],
  index: number,
  endsParagraph: boolean
): PauseKind {
  const word = words[index];
  if (word === undefined || index >= words.length - 1) return "none";
  if (endsParagraph) return "paragraph";

  if (SENTENCE_MARK.test(word)) {
    // "?", "!" e reticencias sempre encerram; o ponto depende do contexto.
    if (/(?:[!?\u2026]|\.\.\.)[^\p{L}\p{N}]*$/u.test(word)) return "sentence";
    const bare = bareLower(word);
    // Tratamento e inicial de nome ("J. R. R. Tolkien") emendam no que vem.
    // So maiuscula: "Sim, e." e "Foi o." terminam a frase.
    if (TITLES.has(bare) || /^[^\p{L}]*\p{Lu}\.$/u.test(word)) return "none";
    const lowerNext = /^[^\p{L}]*\p{Ll}/u.test(words[index + 1] ?? "");
    if (ABBREVIATIONS.has(bare)) return lowerNext ? "none" : "clause";
    // Ponto seguido de minuscula nao fecha frase ("3 p.m. e", "U.S. law").
    return lowerNext ? "clause" : "sentence";
  }

  // O travessao solto nao pausa; quem pausa e a palavra antes dele, como na
  // leitura em voz alta ("ele - que era timido - saiu").
  if (DASH.test(word)) return "none";
  if (CLAUSE_MARK.test(word) || DASH.test(words[index + 1] ?? "")) return "clause";
  return "none";
}

/** Pausas de todo o texto, a partir dos paragrafos. */
export function pauseKinds(words: string[], paragraphs: Paragraph[]): PauseKind[] {
  const ends = new Set<number>();
  for (const paragraph of paragraphs) {
    if (paragraph.words.length > 0) ends.add(paragraph.start + paragraph.words.length - 1);
  }
  return words.map((_, index) => pauseAfter(words, index, ends.has(index)));
}

/** Milissegundos de pausa na velocidade dada. */
export function pauseMs(kind: PauseKind, wpm: number): number {
  if (kind === "none") return 0;
  const { factor, min, max } = PAUSES[kind];
  const perWord = 60_000 / Math.max(wpm, 1);
  return Math.round(Math.min(max, Math.max(min, perWord * factor)));
}

/** Peso extra das palavras que o leitor ja consultou no dicionario. */
export const KNOWN_WORD_BOOST = 1.5;

const DIGIT = /\d/;
const STRIP = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * Peso lexical de uma palavra: quanto tempo ela pede em relacao a media,
 * sem contar a pontuacao (que vira pausa, em `pauseAfter`).
 *
 * Curta passa um pouco mais rapido; longa, numero e nome proprio ficam mais.
 * Token so de pontuacao (o travessao do dialogo) passa rapido. So regras
 * locais, sem modelo de linguagem.
 */
export function wordWeight(word: string, previous: string | undefined): number {
  const bare = word.replace(STRIP, "");
  const length = bare.length;
  if (length === 0) return 0.5;

  let weight =
    length <= 2 ? 0.8 : length <= 4 ? 0.9 : length <= 7 ? 1 : length <= 10 ? 1.12 : length <= 13 ? 1.25 : 1.35;
  if (DIGIT.test(bare)) weight += 0.3;
  // Maiuscula no meio da frase e nome proprio; no comeco, e so a frase.
  const sentenceStart = previous === undefined || SENTENCE_MARK.test(previous);
  if (!sentenceStart && /^\p{Lu}/u.test(bare)) weight += 0.15;
  return weight;
}

/** Forma usada para reconhecer uma palavra ja consultada. */
export function wordKeyForPace(word: string): string {
  return word
    .replace(STRIP, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Nenhuma palavra passa mais de 10% mais rapido que o ppm configurado. Mais
 * que isso e as palavras curtas parecem atropelar o ritmo escolhido.
 */
export const ADAPTIVE_FLOOR = 0.9;
/** Nem fica mais que 1,5 vez o tempo medio, fora o acrescimo de US-88. */
export const ADAPTIVE_CEIL = 1.5;

/**
 * Pesos lexicais de todas as palavras, normalizados para a media do texto.
 *
 * A normalizacao mantem a velocidade media das palavras na configurada (US-87,
 * criterio 3): o tempo e redistribuido, nao acrescentado. As palavras ja
 * consultadas (US-88) ganham o acrescimo por ultimo, sobre o peso final.
 */
export function normalizedWeights(words: string[], known: ReadonlySet<string> = new Set()): number[] {
  const raw = words.map((word, index) => wordWeight(word, words[index - 1]));
  const mean = raw.reduce((sum, weight) => sum + weight, 0) / Math.max(raw.length, 1);

  return raw.map((weight, index) => {
    const base = Math.min(ADAPTIVE_CEIL, Math.max(ADAPTIVE_FLOOR, mean > 0 ? weight / mean : 1));
    return known.size > 0 && known.has(wordKeyForPace(words[index]!))
      ? base * KNOWN_WORD_BOOST
      : base;
  });
}

/**
 * Quanto a palavra fica na tela no Word Runner: a duracao na velocidade (com
 * a rampa de aquecimento), vezes o peso lexical, mais a pausa que vem depois
 * dela.
 */
export function runnerDelayMs(
  wpm: number,
  weight: number,
  pause: PauseKind,
  speedFactor = 1
): number {
  const perWord = 60_000 / Math.max(wpm * speedFactor, 1);
  return perWord * weight + pauseMs(pause, wpm);
}
