/**
 * Regras de ritmo e tempo das epicas de retomada, desistencia, tempo livre e
 * ritmo adaptativo (US-77 a US-88).
 *
 * Todas puras: o leitor, as rotas e os testes chamam as mesmas funcoes, entao
 * a previsao mostrada na tela e a que a tela executa.
 */
import {
  MAX_WPM,
  MIN_WPM,
  WARMUP_START,
  WARMUP_WORDS,
  warmupFactor,
  type Paragraph,
} from "@/lib/reading";
import { pauseMs, pauseOverhead, type PauseKind } from "@/lib/pauses";
import { isListMarker, isSentenceEnd, sentenceMark } from "@/lib/sentences";

// As pausas moram em `pauses.ts` (sem dependencias, para `reading.ts` usar sem
// ciclo) e o segmentador em `sentences.ts`; quem trata de ritmo importa daqui.
export {
  PAUSE_AT_300,
  PAUSE_EXPONENT,
  PAUSE_MAX_MS,
  PAUSE_OVERHEAD,
  PAUSE_RATES,
  pauseMs,
  pauseOverhead,
  type PauseKind,
} from "@/lib/pauses";
export { isSentenceEnd, sentenceBounds } from "@/lib/sentences";

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
 *
 * O leitor desconta da duracao as pausas de pontuacao e o atraso da rampa,
 * entao este e o ritmo das palavras, sem pausas: a previsao de tempo de
 * relogio precisa soma-las de volta (`predictRunnerMs`, `pauseOverhead`).
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
 * aquecimento do inicio quando ela esta ligada (a partir de `start`, o fator
 * de `warmupStart`). So conta palavras: sem as pausas de pontuacao. Com o
 * texto a mao, `predictRunnerMs` e a previsao completa.
 */
export function predictMs(
  words: number,
  wpm: number,
  warmup: boolean,
  start: number = WARMUP_START
): number {
  const perWord = 60_000 / Math.max(wpm, 1);
  if (!warmup) return words * perWord;

  let total = 0;
  const ramp = Math.min(words, WARMUP_WORDS);
  for (let index = 0; index < ramp; index += 1) total += perWord / warmupFactor(index, start);
  return total + Math.max(0, words - ramp) * perWord;
}

/** Opcoes para prever com o texto: o que muda o tempo de cada palavra. */
export interface RunnerPlan {
  /** Ritmo dinamico ligado: pesos e pausas; desligado, toda palavra igual. */
  adaptive: boolean;
  /** Rampa de aquecimento ligada. */
  warmup: boolean;
  /** Idioma do texto (`text.language`), para as abreviaturas do segmentador. */
  language?: string;
  /** Palavras ja consultadas (chaves de `wordKeyForPace`). */
  known?: ReadonlySet<string>;
  /** Fator inicial da rampa (`warmupStart`); o padrao e o da abertura, 0,6. */
  warmupStart?: number;
}

/**
 * Fim do ultimo paragrafo que cabe no tempo, a partir da posicao `from`.
 *
 * Devolve null quando nem o paragrafo atual cabe: um trecho que termina no
 * meio de uma frase nao serve como sugestao (US-84, criterio 3).
 *
 * Com `options.words`, a previsao e a do Word Runner de verdade
 * (`predictRunnerMs`: pesos, pausas de pontuacao e rampa; `adaptive` padrao
 * ligado). Sem, conta so palavras, como antes.
 */
export function fitParagraphEnd(
  paragraphs: Paragraph[],
  from: number,
  budgetMs: number,
  wpm: number,
  warmup: boolean,
  options?: Partial<Omit<RunnerPlan, "warmup">> & { words?: string[] }
): { end: number; predictedMs: number } | null {
  const words = options?.words;
  const delays = words
    ? runnerDelays(words, paragraphs, from, words.length, wpm, {
        adaptive: options.adaptive ?? true,
        warmup,
        language: options.language,
        known: options.known,
        warmupStart: options.warmupStart,
      })
    : null;

  let best: { end: number; predictedMs: number } | null = null;
  let predicted = 0;
  const origin = Math.max(0, Math.trunc(from));
  let cursor = origin;

  for (const paragraph of paragraphs) {
    const end = paragraph.start + paragraph.words.length;
    if (end <= from) continue;

    if (delays) {
      for (; cursor < end; cursor += 1) predicted += delays[cursor - origin] ?? 0;
    } else {
      predicted = predictMs(end - from, wpm, warmup, options?.warmupStart);
    }
    if (predicted > budgetMs) break;
    best = { end, predictedMs: predicted };
  }

  return best;
}

/* --- recapitulacao (US-77, US-78) ----------------------------------------- */

export const RECAP_WORDS = 40;
export const RECAP_AFTER_MS = 48 * 60 * 60 * 1000;
export const RECAP_MAX_HIGHLIGHTS = 5;

/**
 * Trecho a recapitular ao retomar um texto parado (US-77), ou null.
 *
 * So depois de 48 horas sem leitura, alem da palavra 40, e nunca quando o
 * texto foi aberto numa posicao escolhida (`?de=`). O trecho comeca no inicio
 * da frase (pelo segmentador unico), para nao abrir no meio de uma oracao.
 */
export function recapWindow(
  words: string[],
  position: number,
  lastReadAt: Date | null,
  now: Date,
  chosenStart: boolean,
  language?: string
): { from: number; to: number } | null {
  if (chosenStart || !lastReadAt || position <= RECAP_WORDS) return null;
  if (now.getTime() - lastReadAt.getTime() < RECAP_AFTER_MS) return null;

  let from = Math.max(0, position - RECAP_WORDS);
  while (from > 0 && !isSentenceEnd(words, from - 1, language)) from -= 1;
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
 * As pausas seguem uma lei de potencia da duracao da palavra (`pauses.ts`):
 * crescem menos que ela em ritmo lento e encolhem menos em ritmo alto.
 *
 * O que e fim de frase vem do segmentador unico (`sentences.ts`), o mesmo da
 * navegacao, do destaque e da narracao.
 */

/** Descricao das duas opcoes de ritmo, na folha do leitor e nos Ajustes. */
export const RHYTHM_HINTS = {
  dinamico:
    "Como o Word Runner do Kindle: pausa curta na virgula, maior no fim da frase e do paragrafo; palavras longas, numeros e nomes ficam um pouco mais.",
  uniforme: "Toda palavra fica o mesmo tempo, sem pausas de pontuacao.",
} as const;

// Fecha aspas, parenteses e colchetes depois da pontuacao: `(sic),`.
const CLAUSE_MARK = /(?:[,;:]|\))["'”’»)\]]*$/u;
/**
 * Separador solto: travessao, hifen isolado, o "·" que separa as celulas de
 * tabela e a barra vertical. Ele mesmo nao pausa; a palavra antes dele pausa.
 */
const SEPARATOR = /^[–—\-·|]+$/u;
/** Token de citacao numerica: "[2," "3]" "[4-6]." */
const CITATION = /^\[?\d{1,4}(?:[–-]\d{1,4})?(?:,|\][.,;:)]*)?$/u;

/**
 * A virgula da palavra `index` esta dentro de uma citacao so numerica, como
 * "[2, 3]"? Ali ela separa referencias, nao oracoes, e nao pausa.
 */
function inNumericCitation(words: string[], index: number): boolean {
  const word = words[index]!;
  if (!word.endsWith(",") || word.includes("]")) return false;

  let start = index;
  for (; start >= 0 && index - start < 12; start -= 1) {
    const token = words[start]!;
    if (!CITATION.test(token)) return false;
    if (token.startsWith("[")) break;
  }
  if (start < 0 || !words[start]?.startsWith("[")) return false;

  for (let end = index + 1; end < words.length && end - index < 12; end += 1) {
    const token = words[end]!;
    if (!CITATION.test(token)) return false;
    if (token.includes("]")) return true;
  }
  return false;
}

/**
 * Que pausa vem depois da palavra `index`.
 *
 * Fim de paragrafo vale mais que fim de frase, que vale mais que virgula. O
 * que e fim de frase decide `sentenceMark`: tratamento ("Sr."), abreviatura
 * ("p. 12", "cap. 3", "et al. (2020)"), inicial de nome ("J. R. R. Tolkien")
 * e marcador de lista ("1.") emendam sem pausa; ponto seguido de minuscula
 * vira pausa curta.
 */
export function pauseAfter(
  words: string[],
  index: number,
  endsParagraph: boolean,
  language?: string
): PauseKind {
  const word = words[index];
  if (word === undefined || index >= words.length - 1) return "none";
  if (endsParagraph) return "paragraph";

  const mark = sentenceMark(words, index, language);
  if (mark === "end") return "sentence";
  if (mark === "joined") return "none";
  if (mark === "soft") return "clause";
  if (isListMarker(words, index, undefined, language)) return "none";

  // O separador solto nao pausa; quem pausa e a palavra antes dele, como na
  // leitura em voz alta ("ele - que era timido - saiu"). O mesmo vale antes de
  // um parentese: "o autor (2020) mostrou" respira antes do "(".
  if (SEPARATOR.test(word)) return "none";
  if (CLAUSE_MARK.test(word)) return inNumericCitation(words, index) ? "none" : "clause";
  const next = words[index + 1] ?? "";
  if (SEPARATOR.test(next) || next.startsWith("(")) return "clause";
  return "none";
}

/** Titulos, em Markdown. */
const HEADINGS = new Set(["h1", "h2", "h3"]);

function isTableRow(paragraph: Paragraph): boolean {
  // O Markdown junta as celulas de uma linha de tabela com " · " num bloco "p".
  return paragraph.kind === "p" && paragraph.words.includes("·");
}

/**
 * Pausas de todo o texto, a partir dos paragrafos.
 *
 * O tipo do bloco Markdown muda a pausa do fim dele: item de lista e linha de
 * tabela sao frases de uma enumeracao, nao paragrafos (pausa de frase);
 * linhas de codigo seguidas sao uma unidade (pausa de virgula entre elas);
 * titulo fecha como paragrafo. O marcador de lista escrito no texto ("1." no
 * inicio do paragrafo) nao tem pausa propria.
 */
export function pauseKinds(words: string[], paragraphs: Paragraph[], language?: string): PauseKind[] {
  const endKind = new Map<number, PauseKind>();
  const starts = new Set<number>();
  const filled = paragraphs.filter((paragraph) => paragraph.words.length > 0);

  filled.forEach((paragraph, position) => {
    starts.add(paragraph.start);
    const end = paragraph.start + paragraph.words.length - 1;
    const next = filled[position + 1];

    let kind: PauseKind = "paragraph";
    if (paragraph.kind === "li" || paragraph.kind === "oli" || isTableRow(paragraph)) kind = "sentence";
    else if (paragraph.kind === "code" && next?.kind === "code") kind = "clause";
    endKind.set(end, kind);
  });

  return words.map((_, index) => {
    if (index >= words.length - 1) return "none";
    const end = endKind.get(index);
    if (end !== undefined) return end;
    if (starts.has(index) && isListMarker(words, index, true)) return "none";
    return pauseAfter(words, index, false, language);
  });
}

/** Peso extra das palavras que o leitor ja consultou no dicionario. */
export const KNOWN_WORD_BOOST = 1.5;
/** Peso extra das palavras de titulo (h1 a h3): o titulo orienta o resto. */
export const HEADING_BOOST = 1.12;
/**
 * Peso de token sem letras nem digitos ("—", "·", "=", "|"). Nao ha
 * o que reconhecer nele; fica fora da normalizacao, para nao puxar a media.
 */
export const PUNCTUATION_WEIGHT = 0.35;

const DIGIT = /\d/;
const STRIP = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** Palavra sem nenhuma letra nem digito. */
function isPunctuation(word: string): boolean {
  return !/[\p{L}\p{N}]/u.test(word);
}

/** Peso lexical cru pelo tamanho, numero e nome proprio. */
function lexicalWeight(word: string, sentenceStart: boolean): number {
  const bare = word.replace(STRIP, "");
  const length = Array.from(bare).length;
  if (length === 0) return PUNCTUATION_WEIGHT;

  let weight =
    length <= 2 ? 0.8 : length <= 4 ? 0.9 : length <= 7 ? 1 : length <= 10 ? 1.12 : length <= 13 ? 1.25 : 1.35;
  if (DIGIT.test(bare)) weight += 0.3;
  // Maiuscula no meio da frase e nome proprio; no comeco, e so a frase.
  if (!sentenceStart && /^\p{Lu}/u.test(bare)) weight += 0.15;
  return weight;
}

/**
 * Peso lexical de uma palavra: quanto tempo ela pede em relacao a media,
 * sem contar a pontuacao (que vira pausa, em `pauseAfter`).
 *
 * Curta passa um pouco mais rapido; longa, numero e nome proprio ficam mais.
 * Token so de pontuacao (o travessao do dialogo) passa rapido. So regras
 * locais, sem modelo de linguagem. `previous` decide, pelo segmentador, se a
 * palavra abre frase: depois de "Sr." ou "J.", "Silva" e nome e ganha o
 * bonus. `normalizedWeights` olha o texto inteiro e pula tokens so de
 * pontuacao; esta versao avulsa ve so a palavra anterior.
 */
export function wordWeight(word: string, previous: string | undefined, language?: string): number {
  const sentenceStart = previous === undefined || isSentenceEnd([previous, word], 0, language);
  return lexicalWeight(word, sentenceStart);
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
 * Nenhuma palavra passa mais de 10% mais rapido que o ppm configurado. Mais
 * que isso e as palavras curtas parecem atropelar o ritmo escolhido.
 */
export const ADAPTIVE_FLOOR = 0.9;
/** Nem fica mais que 1,5 vez o tempo medio, fora o acrescimo de US-88. */
export const ADAPTIVE_CEIL = 1.5;
/** Rodadas de renormalizacao depois de prender na faixa. */
const NORMALIZE_ROUNDS = 3;

/** Palavras que abrem frase: inicio do texto, de paragrafo ou depois de fim de frase. */
function sentenceStarts(
  words: string[],
  paragraphStarts: ReadonlySet<number>,
  language?: string
): boolean[] {
  return words.map((_, index) => {
    if (paragraphStarts.has(index)) return true;
    // Olha a palavra anterior de verdade: pula aspas, travessao e outros
    // tokens so de pontuacao ("fim. — Bom dia" abre frase em "Bom").
    let previous = index - 1;
    while (previous >= 0 && isPunctuation(words[previous]!)) {
      if (paragraphStarts.has(previous)) return true;
      previous -= 1;
    }
    return previous < 0 || isSentenceEnd(words, previous, language);
  });
}

/**
 * Pesos lexicais de todas as palavras, normalizados para a media do texto.
 *
 * A normalizacao mantem a velocidade media das palavras na configurada (US-87,
 * criterio 3): o tempo e redistribuido, nao acrescentado. Prender os pesos na
 * faixa [0,9; 1,5] desloca a media (as curtas presas no piso sobem); por isso
 * a escala e recalculada sobre as nao presas algumas vezes, ate a media voltar
 * a 1 - antes ela ficava entre 1,016 e 1,034 e o texto andava 2 a 3% mais
 * devagar que o escolhido.
 *
 * Tokens so de pontuacao e marcadores de lista ("1.") ficam fora: tem peso
 * fixo e nao entram na media. Com os paragrafos, o titulo ganha +12% e o
 * inicio de paragrafo conta como inicio de frase. As palavras ja consultadas
 * (US-88) ganham o acrescimo por ultimo, sobre o peso final.
 */
export function normalizedWeights(
  words: string[],
  known: ReadonlySet<string> = new Set(),
  paragraphs?: Paragraph[],
  language?: string
): number[] {
  const paragraphStarts = new Set<number>();
  const heading = new Set<number>();
  for (const paragraph of paragraphs ?? []) {
    if (paragraph.words.length === 0) continue;
    paragraphStarts.add(paragraph.start);
    if (paragraph.kind && HEADINGS.has(paragraph.kind)) {
      for (let offset = 0; offset < paragraph.words.length; offset += 1) {
        heading.add(paragraph.start + offset);
      }
    }
  }

  const starts = sentenceStarts(words, paragraphStarts, language);
  // Peso fixo, fora da media: pontuacao solta e marcador de lista.
  const fixed = words.map((word, index) => {
    if (isPunctuation(word)) return PUNCTUATION_WEIGHT;
    const marker = paragraphs
      ? paragraphStarts.has(index) && isListMarker(words, index, true)
      : isListMarker(words, index, undefined, language);
    return marker ? ADAPTIVE_FLOOR : null;
  });
  const raw = words.map((word, index) =>
    fixed[index] === null ? lexicalWeight(word, starts[index]!) : 0
  );
  const free = raw.filter((_, index) => fixed[index] === null);
  const pin = (weight: number) => Math.min(ADAPTIVE_CEIL, Math.max(ADAPTIVE_FLOOR, weight));

  // Escala que leva a media dos pesos ja presos a 1: parte da media crua e,
  // a cada rodada, divide o que falta pela soma das que ficaram soltas.
  const rawSum = free.reduce((sum, weight) => sum + weight, 0);
  let scale = rawSum > 0 ? free.length / rawSum : 1;
  for (let round = 0; round < NORMALIZE_ROUNDS; round += 1) {
    let pinned = 0;
    let loose = 0;
    for (const weight of free) {
      const scaled = weight * scale;
      if (scaled <= ADAPTIVE_FLOOR || scaled >= ADAPTIVE_CEIL) pinned += pin(scaled);
      else loose += scaled;
    }
    const target = free.length - pinned;
    if (loose <= 0 || target <= 0) break;
    scale *= target / loose;
  }

  return raw.map((weight, index) => {
    let base = fixed[index] ?? pin(weight * scale);
    if (heading.has(index)) base *= HEADING_BOOST;
    return known.size > 0 && known.has(wordKeyForPace(words[index]!))
      ? base * KNOWN_WORD_BOOST
      : base;
  });
}

/**
 * Quanto a palavra fica na tela no Word Runner: a duracao na velocidade vezes
 * o peso lexical, mais a pausa que vem depois dela. A rampa de aquecimento
 * (`speedFactor`) desacelera as duas partes: aquecer so a palavra e manter a
 * pausa cheia deixava o fraseado do inicio desproporcional.
 */
export function runnerDelayMs(
  wpm: number,
  weight: number,
  pause: PauseKind,
  speedFactor = 1
): number {
  const effective = Math.max(wpm * speedFactor, 1);
  const pauseScale = Math.max(wpm, 1) / effective;
  return (60_000 / effective) * weight + pauseMs(pause, wpm) * pauseScale;
}

/* --- previsao com as pausas (Word Runner) --------------------------------- */

/** Duracao de cada palavra de [from, to) no Word Runner, como a tela executa. */
function runnerDelays(
  words: string[],
  paragraphs: Paragraph[],
  from: number,
  to: number,
  wpm: number,
  plan: RunnerPlan
): number[] {
  const start = Math.max(0, Math.trunc(from));
  const end = Math.min(words.length, Math.trunc(to));
  if (end <= start) return [];

  const weights = plan.adaptive
    ? normalizedWeights(words, plan.known ?? new Set(), paragraphs, plan.language)
    : null;
  const pauses = plan.adaptive ? pauseKinds(words, paragraphs, plan.language) : null;
  const first = plan.warmupStart ?? WARMUP_START;

  const delays: number[] = [];
  for (let index = start; index < end; index += 1) {
    const factor = plan.warmup ? warmupFactor(index - start, first) : 1;
    delays.push(runnerDelayMs(wpm, weights?.[index] ?? 1, pauses?.[index] ?? "none", factor));
  }
  return delays;
}

/**
 * Milissegundos de relogio para o Word Runner ler de `from` ate `to`
 * (exclusivo), somando o tempo de cada palavra com peso, pausa de pontuacao e
 * rampa - exatamente o que o leitor agenda. Inclui a pausa depois da ultima
 * palavra do trecho, como a tela. E a previsao a usar quando o texto esta a
 * mao; `predictMs` so conta palavras.
 */
export function predictRunnerMs(
  words: string[],
  paragraphs: Paragraph[],
  from: number,
  to: number,
  wpm: number,
  plan: RunnerPlan
): number {
  return runnerDelays(words, paragraphs, from, to, wpm, plan).reduce((sum, delay) => sum + delay, 0);
}

/**
 * Ritmo de relogio aproximado do Word Runner, em ppm, contando as pausas:
 * "ritmo real ~240 ppm". Com o texto, mede nele (sem a rampa, que so vale no
 * inicio); sem o texto, usa o acrescimo medio das pausas (`pauseOverhead`).
 */
export function effectiveRunnerWpm(
  wpm: number,
  words?: string[],
  paragraphs?: Paragraph[],
  language?: string
): number {
  const safe = Math.min(Math.max(wpm, MIN_WPM), MAX_WPM);
  if (!words || words.length === 0) return Math.round(safe / pauseOverhead(safe));
  const total = predictRunnerMs(words, paragraphs ?? [{ start: 0, words }], 0, words.length, safe, {
    adaptive: true,
    warmup: false,
    language,
  });
  return total > 0 ? Math.round((words.length * 60_000) / total) : safe;
}
