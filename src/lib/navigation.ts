/**
 * Navegacao dentro do texto aberto: frase, busca, sumario, marcadores e as
 * pausas que o leitor faz sozinho (US-89 a US-95, US-104).
 *
 * Tudo trabalha sobre a lista corrida de palavras, que e o que da indice de
 * posicao no leitor. Funcoes puras, testaveis sem navegador.
 */

import type { Paragraph } from "@/lib/reading";

const SENTENCE_END = /[.!?…][")'\]»”’]*$/;

/* --- frase ---------------------------------------------------------------- */

/** Primeira palavra da frase que contem `index`. */
export function sentenceStart(words: string[], index: number): number {
  let position = Math.max(0, Math.min(words.length - 1, Math.trunc(index)));
  while (position > 0 && !SENTENCE_END.test(words[position - 1]!)) position -= 1;
  return Math.max(0, position);
}

/**
 * Destino de "Voltar a frase" (US-91).
 *
 * No meio da frase, volta ao inicio dela. Ja no inicio, volta ao inicio da
 * anterior - senao o comando repetido ficaria preso no mesmo lugar.
 */
export function sentenceBackTarget(words: string[], index: number): number {
  if (words.length === 0) return 0;
  const start = sentenceStart(words, index);
  if (start < index) return start;
  return start === 0 ? 0 : sentenceStart(words, start - 1);
}

/* --- recuo ao retomar ------------------------------------------------------ */

/** Pausa a partir da qual retomar recua algumas palavras (US-95). */
export const REWIND_AFTER_MS = 5_000;
/** Quantas palavras, no maximo, o recuo volta. */
export const REWIND_WORDS = 5;

/**
 * Onde a leitura recomeca depois de uma pausa.
 *
 * Recua ate `REWIND_WORDS` palavras sem passar do inicio da frase: o objetivo
 * e retomar o fio da frase, nao reler a anterior.
 */
export function resumeTarget(words: string[], index: number, pausedMs: number): number {
  if (pausedMs < REWIND_AFTER_MS || index <= 0) return index;
  const floor = sentenceStart(words, index);
  return Math.max(0, floor, index - REWIND_WORDS);
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

/**
 * Pausa extra ao trocar de paragrafo no modo Foco (US-94): 1,5 vez a duracao
 * de uma palavra na velocidade escolhida.
 */
export function paragraphPauseMs(wpm: number): number {
  return Math.round((60_000 / Math.max(1, wpm)) * 1.5);
}

/** Leitura continua antes do aviso de descanso (US-104). */
export const EYE_REST_AFTER_MS = 20 * 60_000;
/** Duracao do descanso sugerido. */
export const EYE_REST_SECONDS = 20;
/** Parada que ja conta como descanso e zera a contagem. */
export const EYE_REST_RESET_MS = 2 * 60_000;
