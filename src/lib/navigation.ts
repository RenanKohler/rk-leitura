/**
 * Navegacao dentro do texto aberto: frase, busca, sumario, marcadores e as
 * pausas que o leitor faz sozinho (US-89 a US-95, US-104); ir para uma
 * porcentagem e a janela dos capitulos da serie (US-226, US-227).
 *
 * Tudo trabalha sobre a lista corrida de palavras, que e o que da indice de
 * posicao no leitor. Funcoes puras, testaveis sem navegador.
 *
 * O que e frase vem do segmentador unico (`sentences.ts`): "O Sr. Silva
 * chegou." e uma frase so em "Voltar a frase", no contexto do Word Runner, no
 * recuo ao retomar, no destaque e no ritmo.
 */

import { readingState } from "@/lib/library";
import { clamp, paragraphRange, type Paragraph } from "@/lib/reading";
import { isSentenceEnd, sentenceStartOf } from "@/lib/sentences";

/* --- frase ---------------------------------------------------------------- */

/** Primeira palavra da frase que contem `index`. */
export function sentenceStart(words: string[], index: number, language?: string): number {
  return sentenceStartOf(words, index, language);
}

/**
 * Destino de "Voltar a frase" (US-91).
 *
 * No meio da frase, volta ao inicio dela. Ja no inicio, volta ao inicio da
 * anterior - senao o comando repetido ficaria preso no mesmo lugar.
 */
export function sentenceBackTarget(words: string[], index: number, language?: string): number {
  if (words.length === 0) return 0;
  const start = sentenceStart(words, index, language);
  if (start < index) return start;
  return start === 0 ? 0 : sentenceStart(words, start - 1, language);
}

/** Inicio da frase seguinte, para "Avancar a frase" no Word Runner. */
export function sentenceForwardTarget(words: string[], index: number, language?: string): number {
  if (words.length === 0) return 0;
  let position = Math.max(0, Math.trunc(index)) + 1;
  while (position < words.length && !isSentenceEnd(words, position - 1, language)) position += 1;
  return Math.min(position, words.length - 1);
}

/* --- contexto do Word Runner ----------------------------------------------- */

/** Palavras, no maximo, de cada bloco da linha de contexto. */
export const CONTEXT_BLOCK = 18;
/** Bloco menor que isso nao vale o corte: fica colado ao vizinho. */
const CONTEXT_MIN_BLOCK = 6;
/** Quanto o corte pode fugir do ponto ideal para cair depois de uma virgula. */
const CONTEXT_SLACK = 6;
/** Pontuacao de oracao, onde o corte do bloco fica natural. */
const CLAUSE_END = /[,;:]["'”’»)\]]*$/u;

/**
 * Trecho mostrado sob a palavra do Word Runner.
 *
 * E a frase atual, sem sair do paragrafo. Frase longa e dividida em blocos
 * fixos de ate `maxBlock` palavras, contados a partir do inicio da frase e
 * cortados de preferencia depois de virgula, ponto e virgula ou dois-pontos;
 * devolve o bloco que contem a palavra. A linha so muda quando a palavra sai
 * do bloco - a janela deslizante anterior mudava a cada palavra e o olho,
 * que deveria ficar no centro, era puxado para a linha de baixo.
 *
 * `clippedStart` e `clippedEnd` dizem se a frase continua alem do bloco.
 */
export function runnerContext(
  words: string[],
  paragraphs: Paragraph[],
  index: number,
  maxBlock = CONTEXT_BLOCK,
  language?: string
): { from: number; to: number; clippedStart: boolean; clippedEnd: boolean } {
  if (words.length === 0) return { from: 0, to: 0, clippedStart: false, clippedEnd: false };
  const position = Math.max(0, Math.min(words.length - 1, Math.trunc(index) || 0));
  const paragraph = paragraphRange(paragraphs, position, words.length);
  const size = Math.max(1, Math.trunc(maxBlock) || CONTEXT_BLOCK);

  const sentenceFrom = Math.max(sentenceStart(words, position, language), paragraph.start);
  let sentenceTo = position + 1;
  while (sentenceTo < paragraph.end && !isSentenceEnd(words, sentenceTo - 1, language)) {
    sentenceTo += 1;
  }

  let from = sentenceFrom;
  let to = sentenceTo;
  while (to - from > size) {
    const remaining = to - from;
    // Blocos de tamanho parecido: 19 palavras viram 10 + 9, nao 18 + 1.
    const ideal = from + Math.ceil(remaining / Math.ceil(remaining / size));
    let cut = ideal;
    let distance = Infinity;
    const first = Math.max(from + Math.min(CONTEXT_MIN_BLOCK, size), ideal - CONTEXT_SLACK);
    for (let end = first; end <= from + size && end < to; end += 1) {
      if (!CLAUSE_END.test(words[end - 1]!)) continue;
      const gap = Math.abs(end - ideal);
      if (gap <= distance) {
        cut = end;
        distance = gap;
      }
    }
    if (position < cut) {
      to = cut;
      break;
    }
    from = cut;
  }

  return { from, to, clippedStart: from > sentenceFrom, clippedEnd: to < sentenceTo };
}

/* --- recuo ao retomar ------------------------------------------------------ */

/** Pausa a partir da qual retomar recua ao inicio da frase (US-95). */
export const REWIND_AFTER_MS = 5_000;
/** A partir daqui recua ao inicio da frase anterior. */
export const REWIND_SENTENCE_MS = 60_000;
/** A partir daqui recua ao inicio do paragrafo. */
export const REWIND_PARAGRAPH_MS = 10 * 60_000;
/** Recuo maximo, em palavras: um paragrafo sem ponto nao volta pagina inteira. */
export const REWIND_MAX_WORDS = 60;
/** Ritmo a partir do qual ate uma pausa curta recua uma palavra. */
export const REWIND_FAST_WPM = 450;

/**
 * Onde a leitura recomeca depois de uma pausa, escalonado pela duracao dela:
 *
 * - menos de 5 s: no mesmo lugar; a 450 ppm ou mais, uma palavra antes (a
 *   palavra da pausa passou rapido demais para ter sido lida), sem sair da
 *   frase;
 * - de 5 s a 1 min: inicio da frase;
 * - de 1 a 10 min: inicio da frase anterior, que da o contexto da atual;
 * - mais de 10 min: inicio do paragrafo (ou da frase anterior, se ela vier
 *   antes); sem os paragrafos, a frase anterior.
 *
 * Nunca volta mais que `REWIND_MAX_WORDS` palavras.
 */
export function resumeTarget(
  words: string[],
  index: number,
  pausedMs: number,
  paragraphs?: Paragraph[],
  wpm?: number,
  language?: string
): number {
  if (index <= 0 || words.length === 0) return index;
  const position = Math.min(Math.trunc(index), words.length - 1);
  const start = sentenceStart(words, position, language);

  let target: number;
  if (pausedMs < REWIND_AFTER_MS) {
    if (wpm === undefined || wpm < REWIND_FAST_WPM) return index;
    target = Math.max(start, position - 1);
  } else if (pausedMs < REWIND_SENTENCE_MS) {
    target = start;
  } else {
    const previous = start === 0 ? 0 : sentenceStart(words, start - 1, language);
    target = previous;
    if (pausedMs > REWIND_PARAGRAPH_MS && paragraphs && paragraphs.length > 0) {
      target = Math.min(previous, paragraphRange(paragraphs, position, words.length).start);
    }
  }

  return Math.max(0, target, position - REWIND_MAX_WORDS);
}

/* --- busca ------------------------------------------------------------------ */

/** Forma comparavel de uma palavra: minuscula, sem acento e sem pontuacao. */
export function searchKey(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Tamanho minimo da busca, em caracteres uteis. */
export const MIN_SEARCH_CHARS = 2;
/** Mais que isso nao cabe numa lista util, e a contagem vira "500+". */
export const MAX_SEARCH_RESULTS = 500;

/**
 * Indices de palavra onde a expressao comeca (US-90).
 *
 * A comparacao e por sequencia de palavras normalizadas, entao "memoria de
 * trabalho" acha "Memória de trabalho," - e o resultado e sempre um indice de
 * palavra valido para posicionar a leitura. A ultima palavra da busca casa
 * pelo prefixo, para achar enquanto se digita.
 */
export function searchWords(words: string[], query: string): number[] {
  const terms = query.split(/\s+/).map(searchKey).filter(Boolean);
  if (terms.join("").length < MIN_SEARCH_CHARS) return [];

  const keys = words.map(searchKey);
  const last = terms.length - 1;
  const results: number[] = [];

  for (let start = 0; start + terms.length <= keys.length; start += 1) {
    let match = true;
    for (let offset = 0; offset < terms.length; offset += 1) {
      const key = keys[start + offset]!;
      const term = terms[offset]!;
      if (offset === last ? !key.startsWith(term) : key !== term) {
        match = false;
        break;
      }
    }
    if (match) {
      results.push(start);
      if (results.length >= MAX_SEARCH_RESULTS) break;
    }
  }

  return results;
}

/* --- sumario ------------------------------------------------------------------ */

export interface Heading {
  level: 1 | 2 | 3;
  title: string;
  start: number;
}

/** Titulos do texto, na ordem, para o sumario (US-89). */
export function textHeadings(paragraphs: Paragraph[]): Heading[] {
  const headings: Heading[] = [];
  for (const paragraph of paragraphs) {
    const level = paragraph.kind === "h1" ? 1 : paragraph.kind === "h2" ? 2 : paragraph.kind === "h3" ? 3 : 0;
    if (level === 0 || paragraph.words.length === 0) continue;
    headings.push({ level, title: paragraph.words.join(" "), start: paragraph.start });
  }
  return headings;
}

/** Titulo da secao em que `index` esta, ou -1 antes do primeiro titulo. */
export function currentHeading(headings: Heading[], index: number): number {
  let current = -1;
  for (let position = 0; position < headings.length; position += 1) {
    if (headings[position]!.start <= index) current = position;
    else break;
  }
  return current;
}

/* --- ir para uma porcentagem ------------------------------------------------ */

/**
 * Onde a leitura esta, em porcentagem inteira do texto: o valor com que o
 * controle "Ir para" abre (US-227). Texto vazio da 0.
 */
export function percentAt(index: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.round(clamp((index / total) * 100, 0, 100));
}

/**
 * Destino de "Ir para N%" (US-227): o comeco do paragrafo que contem a
 * palavra de numero floor(total * N / 100).
 *
 * O comeco do paragrafo, e nao a palavra exata: a conta cai quase sempre no
 * meio de uma frase, e quem pulou para la teria de voltar para entender onde
 * esta. A porcentagem fora de 0 a 100 e limitada, e 100 aponta para a ultima
 * palavra (`total - 1`), nao para depois do fim: o destino e sempre um lugar
 * de onde ainda ha o que ler. Texto vazio da 0.
 */
export function positionAtPercent(paragraphs: Paragraph[], total: number, percent: number): number {
  const count = Math.max(0, Math.trunc(total) || 0);
  if (count === 0) return 0;
  const word = Math.min(count - 1, Math.floor((count * clamp(percent, 0, 100)) / 100));
  // Sem os paragrafos nao ha comeco a procurar: vale a propria palavra.
  if (paragraphs.length === 0) return word;
  return paragraphRange(paragraphs, word, count).start;
}

/**
 * Tempo que falta, como o cabecalho do leitor o escreve: "~12 min",
 * "~1 h 5 min" ou "< 1 min".
 */
export function remainingLabel(ms: number): string {
  const minutes = Math.round(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `~${minutes} min`;
  return `~${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/* --- capitulos da serie ------------------------------------------------------ */

/** Ate este tamanho a serie aparece inteira na folha Navegar (US-226). */
export const CHAPTERS_SHOWN_WHOLE = 5;
/** Capitulos de cada lado do aberto enquanto a lista esta recolhida. */
export const CHAPTER_NEIGHBORS = 1;

/**
 * Trecho [from, to) da lista de capitulos mostrado antes de "Mostrar todos".
 *
 * Um livro tem dezenas de capitulos, e a lista inteira empurraria o sumario
 * e os marcadores para longe. O que se procura no meio da leitura e quase
 * sempre o capitulo seguinte ou o anterior, entao a janela e o aberto e os
 * vizinhos - sempre do mesmo tamanho, mesmo no primeiro e no ultimo, para a
 * folha nao mudar de altura de um capitulo para o outro.
 */
export function chapterWindow(
  count: number,
  current: number,
  whole: number = CHAPTERS_SHOWN_WHOLE,
  neighbors: number = CHAPTER_NEIGHBORS
): { from: number; to: number } {
  const total = Math.max(0, Math.trunc(count) || 0);
  if (total <= whole) return { from: 0, to: total };
  const size = Math.min(total, 2 * Math.max(0, neighbors) + 1);
  const from = clamp(Math.trunc(current) - Math.max(0, neighbors), 0, total - size);
  return { from, to: from + size };
}

/**
 * Estado do capitulo na linha da lista: "lido", "37%" ou "não lido", pelos
 * mesmos cortes da biblioteca (`readingState`).
 *
 * O largado (US-79) entra na lista, como no cartao da serie, mas sem a
 * porcentagem: pela posicao ele seria leitura em andamento, e e isso que
 * largar quer deixar de dizer.
 */
export function chapterStateLabel(chapter: {
  progressIndex: number;
  wordCount: number;
  abandoned?: boolean;
}): string {
  const state = readingState(chapter);
  if (state.kind === "lido") return "lido";
  if (chapter.abandoned) return "largado";
  return state.kind === "lendo" ? `${state.percent}%` : "não lido";
}

/* --- marcadores ------------------------------------------------------------- */

/** Limite por texto (US-92). */
export const MAX_BOOKMARKS = 50;
export const MAX_BOOKMARK_LABEL = 80;

/** Nome padrao do marcador: as 5 primeiras palavras a partir da posicao. */
export function bookmarkLabel(words: string[], position: number): string {
  const label = words.slice(position, position + 5).join(" ");
  return label.slice(0, MAX_BOOKMARK_LABEL) || "Marcador";
}

/* --- pausas ------------------------------------------------------------------- */

/** Leitura continua antes do aviso de descanso (US-104). */
export const EYE_REST_AFTER_MS = 20 * 60_000;
/** Duracao do descanso sugerido. */
export const EYE_REST_SECONDS = 20;
/** Parada que ja conta como descanso e zera a contagem. */
export const EYE_REST_RESET_MS = 2 * 60_000;
