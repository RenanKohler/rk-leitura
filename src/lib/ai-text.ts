/**
 * Recortes do texto enviados ao modelo. Funcoes puras, com teste.
 *
 * A regra que vale para toda funcao "sobre o que ja li" (US-128, US-130,
 * US-132): o recorte termina na posicao de leitura e nunca inclui palavra
 * depois dela. Ela e garantida aqui, na montagem, e nao pedida ao modelo.
 */

import type { Paragraph } from "@/lib/reading";

/** Teto do trecho lido enviado em uma chamada (cerca de 50 mil tokens). */
export const MAX_READ_CHARS = 200_000;

export interface Excerpt {
  /** Texto enviado: palavras separadas por espaco, paragrafos por linha em branco. */
  text: string;
  /** Indice, no texto inteiro, da primeira palavra do recorte. */
  startWord: number;
  /** Palavra seguinte a ultima enviada: o recorte cobre [startWord, endWord). */
  endWord: number;
  /** Posicao (em caracteres) de cada palavra dentro de `text`. */
  offsets: number[];
  /** O comeco do trecho lido ficou de fora por causa do teto. */
  truncated: boolean;
}

/**
 * Monta o texto das palavras [from, to), em paragrafos. Quando passa de
 * `maxChars`, guarda o fim: os paragrafos mais perto de `to`, que sao os que
 * importam para quem esta lendo agora.
 */
export function excerptOf(
  paragraphs: Paragraph[],
  from: number,
  to: number,
  maxChars: number = MAX_READ_CHARS
): Excerpt {
  const blocks: { start: number; words: string[] }[] = [];
  for (const paragraph of paragraphs) {
    const end = paragraph.start + paragraph.words.length;
    if (end <= from) continue;
    if (paragraph.start >= to) break;
    const a = Math.max(from, paragraph.start) - paragraph.start;
    const b = Math.min(to, end) - paragraph.start;
    if (b > a) blocks.push({ start: paragraph.start + a, words: paragraph.words.slice(a, b) });
  }

  // Do fim para o comeco, ate o teto.
  let size = 0;
  let first = blocks.length;
  while (first > 0) {
    const block = blocks[first - 1]!;
    const length = block.words.join(" ").length + (first < blocks.length ? 2 : 0);
    if (size + length > maxChars && first < blocks.length) break;
    size += length;
    first -= 1;
  }
  const kept = blocks.slice(first);

  let text = "";
  const offsets: number[] = [];
  kept.forEach((block, index) => {
    if (index > 0) text += "\n\n";
    block.words.forEach((word, position) => {
      if (position > 0) text += " ";
      offsets.push(text.length);
      text += word;
    });
  });

  // Um paragrafo sozinho maior que o teto e cortado pelo fim.
  if (text.length > maxChars) {
    const cut = text.length - maxChars;
    const skip = offsets.findIndex((offset) => offset >= cut);
    const dropped = skip === -1 ? offsets.length : skip;
    const base = offsets[dropped] ?? text.length;
    const startWord = (kept[0]?.start ?? from) + dropped;
    return {
      text: text.slice(base),
      startWord,
      endWord: startWord + offsets.length - dropped,
      offsets: offsets.slice(dropped).map((offset) => offset - base),
      truncated: true,
    };
  }

  const startWord = kept[0]?.start ?? from;
  return {
    text,
    startWord,
    endWord: startWord + offsets.length,
    offsets,
    truncated: first > 0 || (kept.length > 0 && startWord > from),
  };
}

/** Palavra do texto inteiro que contem o caractere `char` do recorte. */
export function wordAtChar(excerpt: Pick<Excerpt, "offsets" | "startWord">, char: number): number {
  const { offsets } = excerpt;
  if (offsets.length === 0) return excerpt.startWord;
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (offsets[middle]! <= char) low = middle;
    else high = middle - 1;
  }
  return excerpt.startWord + low;
}
