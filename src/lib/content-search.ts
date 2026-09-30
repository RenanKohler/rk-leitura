/**
 * Busca no conteudo da biblioteca (APP-16): a parte pura, que transforma o
 * comeco do texto ate a ocorrencia em trecho e indice de palavra. A consulta
 * fica em `lib/learning-queries.ts`.
 */

import { asTextFormat, parseParagraphs } from "@/lib/reading";
import type { ContentMatch } from "@/lib/types";

/** Caracteres de contexto antes e depois da ocorrencia. */
export const EXCERPT_BEFORE = 80;
export const EXCERPT_AFTER = 120;

/** Trecho e indice de palavra a partir do comeco do texto ate a ocorrencia. */
export function contentMatchFrom(
  row: { id: string; title: string; format: string; position: number; head: string },
  queryLength: number
): ContentMatch {
  const at = Math.max(0, row.position - 1);
  const prefix = row.head.slice(0, at);
  const counted = parseParagraphs(prefix, asTextFormat(row.format)).words.length;
  // Ocorrencia no meio de uma palavra: o prefixo contou o pedaco dela.
  const midWord = prefix.length > 0 && !/\s$/.test(prefix);
  const wordIndex = Math.max(0, midWord ? counted - 1 : counted);

  const from = Math.max(0, at - EXCERPT_BEFORE);
  const to = Math.min(row.head.length, at + queryLength + EXCERPT_AFTER);
  // `head` vem cortado pelo banco logo depois da ocorrencia: se ele encheu o
  // corte, o texto continua alem do trecho.
  const more = to < row.head.length || row.head.length >= at + queryLength + EXCERPT_AFTER;
  const excerpt = `${from > 0 ? "..." : ""}${row.head.slice(from, to).replace(/\s+/g, " ").trim()}${
    more ? "..." : ""
  }`;

  return { id: row.id, title: row.title, excerpt, wordIndex };
}
