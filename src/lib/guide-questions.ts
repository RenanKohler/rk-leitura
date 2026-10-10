/**
 * Perguntas-guia antes de ler uma secao (US-166). Funcoes puras, com teste.
 *
 * E a unica funcao que envia texto a frente da posicao de leitura: a secao
 * inteira, so ela, e so com a opcao ligada pelo leitor. Cada pergunta vem
 * com o trecho da secao que a responde, conferido literalmente, para o
 * "Ver no texto" depois da leitura.
 */

import { findQuote, spanText } from "@/lib/passage-match";
import type { TextSection } from "@/lib/text-sections";

export const MAX_GUIDE_QUESTIONS = 3;
export const MAX_GUIDE_QUESTION_CHARS = 200;
/** Teto da secao enviada: uma secao enorme vai so pelo comeco. */
export const MAX_GUIDE_SECTION_WORDS = 6_000;

export const NO_SECTIONS = "Este texto não tem seções.";

/** Opcao por aparelho: o ajuste da conta nao tem coluna para ela. */
export const GUIDE_OPTION_KEY = "rk-leitura:perguntas-guia";
export const GUIDE_OPTION_EVENT = "rk-leitura:perguntas-guia";

export interface GuideQuestion {
  question: string;
  /** Trecho da secao que responde a pergunta. */
  quote: string;
  start: number;
  end: number;
}

/** Intervalo enviado: a secao, cortada no teto pelo comeco. */
export function guideRange(section: TextSection): { from: number; to: number } {
  return { from: section.start, to: Math.min(section.end, section.start + MAX_GUIDE_SECTION_WORDS) };
}

/** Chave das perguntas guardadas: texto, impressao do conteudo e secao. */
export function guideKey(textId: string, fingerprint: string, sectionStart: number): string {
  return `${textId}:${fingerprint}:${sectionStart}`;
}

/** Ate 3 perguntas, cada uma com um trecho que aparece no intervalo enviado. */
export function validGuide(
  raw: unknown,
  words: string[],
  keys: string[],
  range: { from: number; to: number }
): GuideQuestion[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { questions?: unknown }).questions)
      ? (raw as { questions: unknown[] }).questions
      : [];
  const seen = new Set<string>();
  const result: GuideQuestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rawQuestion = (item as { question?: unknown }).question;
    const question = typeof rawQuestion === "string" ? rawQuestion.replace(/\s+/g, " ").trim() : "";
    if (!question || question.length > MAX_GUIDE_QUESTION_CHARS) continue;
    if (seen.has(question.toLowerCase())) continue;
    const span = findQuote(keys, (item as { quote?: unknown }).quote, range.from, range.to);
    if (!span) continue;
    seen.add(question.toLowerCase());
    result.push({ question, quote: spanText(words, span), start: span.start, end: span.end });
    if (result.length === MAX_GUIDE_QUESTIONS) break;
  }
  return result;
}

/** Perguntas lidas do banco, ou null quando o formato nao confere. */
export function parseStoredGuide(raw: unknown): GuideQuestion[] | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { questions?: unknown }).questions;
  if (!Array.isArray(list)) return null;
  return list.filter(
    (item): item is GuideQuestion =>
      Boolean(item) &&
      typeof item.question === "string" &&
      typeof item.quote === "string" &&
      Number.isInteger(item.start) &&
      Number.isInteger(item.end)
  );
}

/**
 * Quando mostrar as perguntas: a leitura entrou numa secao nova, andando para
 * frente. Abrir o texto no meio de uma secao, ou voltar a uma anterior, nao
 * mostra nada; abrir exatamente no inicio dela, sim.
 */
export function guideTrigger(
  previous: number | null,
  current: number,
  index: number,
  sections: TextSection[]
): boolean {
  if (current < 0) return false;
  if (previous === null) return sections[current]?.start === index;
  return current > previous;
}
