/**
 * Analise da previa da importacao (US-136 e US-137). Funcoes puras, com teste.
 *
 * O modelo nunca devolve texto: na limpeza ele aponta indices de paragrafo, e
 * nas etiquetas escolhe nomes de uma lista fechada. O que vai ser salvo e
 * montado aqui, a partir do texto extraido, entao um paragrafo mantido sai
 * identico ao que a pagina tinha.
 */

import { sameTag } from "@/lib/tags";

/** Separador de paragrafos do texto extraido (`collectBlocks` em parser.ts). */
const PARAGRAPH_BREAK = "\n\n";

/** Teto de cada paragrafo no pedido: para julgar se e resto, o comeco basta. */
export const MAX_PARAGRAPH_CHARS = 300;

/** Teto do pedido de limpeza inteiro, em caracteres. */
export const MAX_CLEANUP_CHARS = 40_000;

/** Palavras do comeco do texto enviadas para sugerir etiquetas. */
export const TAG_EXCERPT_WORDS = 1_500;

/** Sugestoes de etiqueta mostradas no seletor. */
export const MAX_TAG_SUGGESTIONS = 3;

/** Motivos que o modelo pode dar, mostrados ao lado da marcacao. */
export const LEFTOVER_REASONS = [
  "navegação",
  "anúncio",
  "leia também",
  "aviso",
  "outro",
] as const;

export type LeftoverReason = (typeof LEFTOVER_REASONS)[number];

export interface Leftover {
  index: number;
  reason: LeftoverReason;
}

export function splitParagraphs(content: string): string[] {
  return content.split(PARAGRAPH_BREAK);
}

/**
 * Paragrafos numerados para o pedido. Os longos vao cortados e, passado o
 * teto, os do fim ficam de fora: eles nunca sao marcados.
 */
export function numberedParagraphs(
  content: string,
  maxChars: number = MAX_CLEANUP_CHARS
): { prompt: string; count: number } {
  const lines: string[] = [];
  let size = 0;
  for (const [index, paragraph] of splitParagraphs(content).entries()) {
    const clipped =
      paragraph.length > MAX_PARAGRAPH_CHARS
        ? `${paragraph.slice(0, MAX_PARAGRAPH_CHARS)}...`
        : paragraph;
    const line = `[${index}] ${clipped}`;
    if (size + line.length > maxChars && lines.length > 0) break;
    lines.push(line);
    size += line.length + 1;
  }
  return { prompt: lines.join("\n"), count: lines.length };
}

/**
 * Aceita da resposta so o que aponta para um paragrafo existente, uma vez por
 * indice. Marcar tudo e sinal de que o modelo nao entendeu a pagina: nesse
 * caso nada e marcado, porque a previa riscada inteira nao ajudaria ninguem.
 */
export function validLeftovers(raw: unknown, paragraphs: number): Leftover[] {
  if (!Array.isArray(raw) || paragraphs <= 0) return [];
  const seen = new Set<number>();
  const result: Leftover[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { index, reason } = item as { index?: unknown; reason?: unknown };
    if (typeof index !== "number" || !Number.isInteger(index)) continue;
    if (index < 0 || index >= paragraphs || seen.has(index)) continue;
    seen.add(index);
    const known = LEFTOVER_REASONS.find((value) => value === reason);
    result.push({ index, reason: known ?? "outro" });
  }
  if (result.length >= paragraphs) return [];
  return result.sort((a, b) => a.index - b.index);
}

/** Texto a salvar: o extraido sem os paragrafos removidos, os demais intactos. */
export function applyRemovals(content: string, removed: Iterable<number>): string {
  const skip = new Set(removed);
  if (skip.size === 0) return content;
  return splitParagraphs(content)
    .filter((_, index) => !skip.has(index))
    .join(PARAGRAPH_BREAK);
}

/** Titulo e as primeiras palavras do texto, para sugerir etiquetas. */
export function tagExcerpt(
  title: string,
  content: string,
  maxWords: number = TAG_EXCERPT_WORDS
): string {
  let end = content.length;
  let words = 0;
  for (const match of content.matchAll(/\S+/g)) {
    words += 1;
    if (words === maxWords) {
      end = match.index + match[0].length;
      break;
    }
  }
  return `Título: ${title.trim()}\n\n${content.slice(0, end).trim()}`;
}

/**
 * Sugestoes que o seletor mostra: so etiquetas da conta, sem repetir e sem as
 * ja escolhidas, ate o teto. O nome volta com a grafia guardada.
 */
export function validSuggestions(
  raw: unknown,
  known: string[],
  chosen: string[] = []
): string[] {
  if (!Array.isArray(raw)) return [];
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const name = known.find((candidate) => sameTag(candidate, item));
    if (!name) continue;
    if (result.some((value) => sameTag(value, name))) continue;
    if (chosen.some((value) => sameTag(value, name))) continue;
    result.push(name);
    if (result.length >= MAX_TAG_SUGGESTIONS) break;
  }
  return result;
}
