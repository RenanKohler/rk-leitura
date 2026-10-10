/**
 * Explicar com as proprias palavras e receber apontamentos (US-167). Funcoes
 * puras, com teste.
 *
 * So vai ao modelo o que ja foi lido: a secao escolhida, cortada na posicao
 * de leitura, ou todo o trecho lido quando o texto nao tem secoes. Os
 * apontamentos nao tem nota nem porcentagem, e cada um traz o trecho do
 * texto que o sustenta, conferido literalmente.
 */

import { countWords } from "@/lib/reading";
import { findQuote, spanText } from "@/lib/passage-match";
import { isConcluded, type ReadingProgress } from "@/lib/study-cards";
import type { TextSection } from "@/lib/text-sections";

export const MIN_EXPLANATION_WORDS = 30;
export const MAX_EXPLANATION_WORDS = 300;
export const MAX_POINTS = 4;
export const MAX_POINT_CHARS = 400;

export const EXPLANATION_TOO_SHORT = "Escreva pelo menos 30 palavras.";
export const EXPLANATION_TOO_LONG = "Escreva até 300 palavras.";
export const NOTHING_READ = "Leia um pouco do texto antes de explicar.";

/** Palavras ja lidas: a posicao atual conta, como no resto do app. */
export function wordsRead(progress: ReadingProgress): number {
  if (progress.wordCount <= 0) return 0;
  if (isConcluded(progress)) return progress.wordCount;
  return Math.max(0, Math.min(progress.wordCount, Math.trunc(progress.progressIndex) + 1));
}

/** Explicacao normalizada, ou a mensagem do que falta. */
export function checkExplanation(value: unknown): { text: string } | { error: string } {
  const text = typeof value === "string" ? value.replace(/[ \t]+/g, " ").trim() : "";
  const size = countWords(text);
  if (size < MIN_EXPLANATION_WORDS) return { error: EXPLANATION_TOO_SHORT };
  if (size > MAX_EXPLANATION_WORDS) return { error: EXPLANATION_TOO_LONG };
  return { text };
}

export interface ReadPart {
  /** Titulo da secao; nulo para "todo o trecho lido". */
  title: string | null;
  start: number;
  end: number;
  /** A secao continua alem da posicao de leitura. */
  partial: boolean;
}

/**
 * O que o leitor pode escolher: as secoes que comecam antes da posicao,
 * cada uma cortada nela; sem secoes, o trecho lido inteiro.
 */
export function readParts(sections: TextSection[], read: number): ReadPart[] {
  if (read <= 0) return [];
  if (sections.length === 0) return [{ title: null, start: 0, end: read, partial: false }];
  const parts: ReadPart[] = [];
  for (const section of sections) {
    if (section.start >= read) break;
    const end = Math.min(section.end, read);
    if (end <= section.start) continue;
    parts.push({ title: section.title, start: section.start, end, partial: end < section.end });
  }
  return parts;
}

/** Parte escolhida pelo inicio, ou null quando nao e uma das oferecidas. */
export function pickPart(parts: ReadPart[], start: unknown): ReadPart | null {
  if (start === null || start === undefined) return parts.length === 1 ? parts[0]! : null;
  const value = Number(start);
  return parts.find((part) => part.start === value) ?? null;
}

export interface TeachBackPoint {
  text: string;
  quote: string;
  start: number;
  end: number;
}

/** Ate 4 apontamentos, cada um com um trecho que aparece na parte enviada. */
export function validPoints(
  raw: unknown,
  words: string[],
  keys: string[],
  part: { start: number; end: number }
): TeachBackPoint[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { points?: unknown }).points)
      ? (raw as { points: unknown[] }).points
      : [];
  const result: TeachBackPoint[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rawText = (item as { text?: unknown }).text;
    const text = typeof rawText === "string" ? rawText.replace(/\s+/g, " ").trim() : "";
    if (!text || text.length > MAX_POINT_CHARS || seen.has(text.toLowerCase())) continue;
    const span = findQuote(keys, (item as { quote?: unknown }).quote, part.start, part.end);
    if (!span) continue;
    seen.add(text.toLowerCase());
    result.push({ text, quote: spanText(words, span), start: span.start, end: span.end });
    if (result.length === MAX_POINTS) break;
  }
  return result;
}
