/**
 * Cartao a partir de um trecho selecionado no leitor (US-158). Funcoes puras,
 * com teste, compartilhadas entre servidor e cliente.
 *
 * O pedido leva o trecho selecionado e o paragrafo anterior a ele, e nada
 * depois do trecho. A regra vale na montagem (`passageExcerpt`), nao no
 * pedido ao modelo.
 */

import { excerptOf } from "@/lib/ai-text";
import type { Span } from "@/lib/highlights";
import type { Paragraph } from "@/lib/reading";
import { cardSide, MAX_CARD_SIDE_CHARS } from "@/lib/study-cards";

/** Trecho maior que isso nao vira cartao: nada e enviado. */
export const MAX_PASSAGE_WORDS = 300;
export const PASSAGE_TOO_LONG = "Selecione um trecho menor, de até 300 palavras.";

/** Palavras do trecho selecionado. */
export function passageWords(span: Span): number {
  return Math.max(0, Math.trunc(span.end) - Math.trunc(span.start));
}

/** Intervalo valido dentro do texto, ou null. Nao confere o tamanho. */
export function passageSpan(raw: { start?: unknown; end?: unknown } | null, total: number): Span | null {
  const start = Number(raw?.start);
  const end = Number(raw?.end);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end <= start || end > total) return null;
  return { start, end };
}

export interface PassageExcerpt {
  /** Paragrafo anterior ao do trecho; vazio quando o trecho esta no primeiro. */
  previous: string;
  /** O trecho selecionado. */
  passage: string;
  /** Palavra seguinte a ultima enviada: nada a partir dela sai do app. */
  endWord: number;
}

/**
 * O que vai ao modelo: o paragrafo anterior ao que contem o inicio do
 * trecho, inteiro, e o trecho. O comeco do paragrafo do proprio trecho, antes
 * da selecao, fica de fora, e nada depois do fim da selecao entra.
 */
export function passageExcerpt(paragraphs: Paragraph[], span: Span): PassageExcerpt {
  let current = -1;
  for (let position = 0; position < paragraphs.length; position += 1) {
    const paragraph = paragraphs[position]!;
    if (paragraph.words.length === 0) continue;
    if (paragraph.start <= span.start) current = position;
    else break;
  }
  let previousIndex = current - 1;
  while (previousIndex >= 0 && paragraphs[previousIndex]!.words.length === 0) previousIndex -= 1;
  const before = previousIndex >= 0 ? paragraphs[previousIndex]! : null;

  const previous = before
    ? excerptOf(paragraphs, before.start, Math.min(span.start, before.start + before.words.length)).text
    : "";
  const passage = excerptOf(paragraphs, span.start, span.end).text;
  return { previous, passage, endWord: span.end };
}

/** Mensagem do pedido, com o contexto antes e o trecho marcado. */
export function passageMessage(title: string, excerpt: PassageExcerpt): string {
  const parts = [`Título: ${title}`];
  if (excerpt.previous) parts.push(`Parágrafo anterior (só contexto):\n\n${excerpt.previous}`);
  parts.push(`Trecho selecionado:\n\n${excerpt.passage}`);
  return parts.join("\n\n");
}

export interface CardProposal {
  front: string;
  back: string;
}

/** Proposta do modelo validada, ou null quando um dos lados nao serve. */
export function cardProposal(raw: unknown): CardProposal | null {
  if (!raw || typeof raw !== "object") return null;
  const { front, back } = raw as { front?: unknown; back?: unknown };
  const cleanFront = cardSide(front);
  const cleanBack = cardSide(back);
  return cleanFront && cleanBack ? { front: cleanFront, back: cleanBack } : null;
}

/**
 * Formulario quando a IA nao responde: o trecho no verso, cortado no limite
 * do lado do cartao, e a frente vazia para o leitor completar.
 */
export function fallbackProposal(passage: string): CardProposal {
  const clean = passage.replace(/\s+/g, " ").trim();
  const back =
    clean.length > MAX_CARD_SIDE_CHARS ? `${clean.slice(0, MAX_CARD_SIDE_CHARS - 1).trimEnd()}…` : clean;
  return { front: "", back };
}
