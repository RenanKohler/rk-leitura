/**
 * Explicar uma frase (US-127). Funcoes puras, com teste.
 *
 * A frase vem do segmentador unico, e o pedido leva so ela e o que veio antes
 * (o paragrafo anterior e o comeco do paragrafo dela): nada depois da frase
 * sai do app. A regra e garantida aqui, na montagem, e nao pedida ao modelo.
 */

import { contentKey } from "@/lib/quiz";
import { DEFAULT_LANGUAGE } from "@/lib/language";
import type { Paragraph } from "@/lib/reading";
import { sentenceBounds } from "@/lib/sentences";

/** Teto da explicacao, em palavras. */
export const MAX_EXPLANATION_WORDS = 80;

/** Teto da frase enviada: um paragrafo sem pontuacao nao vira um envio enorme. */
export const MAX_SENTENCE_WORDS = 120;

/** Teto do contexto anterior a frase, em caracteres. */
export const MAX_CONTEXT_CHARS = 3_000;

/** Tempo maximo de espera pela explicacao. */
export const EXPLAIN_TIMEOUT_MS = 30_000;

export const EXPLAIN_FAILURE = "Não consegui explicar agora.";

export interface ExplainRequest {
  /** Intervalo `[start, end)` da frase, no indice do texto inteiro. */
  start: number;
  end: number;
  sentence: string;
  /** Paragrafo anterior e comeco do paragrafo da frase. Nunca o que vem depois. */
  before: string;
}

/** Paragrafo que contem a palavra `index`, ou -1. */
function paragraphAt(paragraphs: Paragraph[], index: number): number {
  let low = 0;
  let high = paragraphs.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (paragraphs[middle]!.start <= index) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (found === -1) return -1;
  const paragraph = paragraphs[found]!;
  return index < paragraph.start + paragraph.words.length ? found : -1;
}

/**
 * Frase da palavra `index` e o contexto anterior a ela.
 *
 * A frase nao atravessa o paragrafo: um titulo sem ponto final nao se junta a
 * frase seguinte. Frase longa demais e recortada em volta da palavra tocada.
 */
export function explainRequest(
  words: string[],
  paragraphs: Paragraph[],
  index: number,
  language?: string
): ExplainRequest | null {
  if (words.length === 0) return null;
  const position = Math.max(0, Math.min(words.length - 1, Math.trunc(index) || 0));
  const current = paragraphAt(paragraphs, position);
  const paragraph = current === -1 ? null : paragraphs[current]!;
  const from = paragraph?.start ?? 0;
  const to = paragraph ? paragraph.start + paragraph.words.length : words.length;

  let { start, end } = sentenceBounds(words, position, language);
  start = Math.max(start, from);
  end = Math.min(end, to);
  if (end - start > MAX_SENTENCE_WORDS) {
    start = Math.max(start, position - Math.floor(MAX_SENTENCE_WORDS / 2));
    end = Math.min(end, start + MAX_SENTENCE_WORDS);
  }

  const previous = current > 0 ? paragraphs[current - 1]!.words.join(" ") : "";
  const opening = words.slice(from, start).join(" ");
  let before = [previous, opening].filter(Boolean).join("\n\n");
  // Guarda o fim: o que esta mais perto da frase e o que ajuda a entende-la.
  if (before.length > MAX_CONTEXT_CHARS) {
    before = before.slice(before.length - MAX_CONTEXT_CHARS);
    const space = before.indexOf(" ");
    if (space !== -1) before = before.slice(space + 1);
  }

  return { start, end, sentence: words.slice(start, end).join(" "), before };
}

/**
 * Chave da explicacao em cache: texto, impressao do conteudo, idioma fora do
 * portugues e intervalo da frase. Conteudo mudado nao encontra a antiga.
 */
export function explanationKey(
  textId: string,
  content: string,
  language: string,
  range: { start: number; end: number }
): string {
  const lang = language === DEFAULT_LANGUAGE ? "" : `:${language}`;
  return `${textId}:${contentKey(content)}${lang}:${range.start}-${range.end}`;
}

export interface Explanation {
  /** A frase reescrita em linguagem simples, em portugues. */
  simple: string;
  /** Traducao da frase, so em texto de outro idioma. */
  translation: string | null;
  /** Explicacao em portugues, com no maximo `MAX_EXPLANATION_WORDS` palavras. */
  explanation: string;
}

/** Corta em `max` palavras, terminando em reticencias quando cortou. */
export function limitWords(value: string, max: number): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= max) return parts.join(" ");
  return `${parts.slice(0, max).join(" ").replace(/[.,;:!?…]+$/u, "")}…`;
}

/**
 * Aceita so o que a folha consegue mostrar. Em texto portugues a traducao sai,
 * mesmo que o modelo a tenha preenchido.
 */
export function parseExplanation(raw: unknown, foreign: boolean): Explanation | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const read = (key: string) => (typeof source[key] === "string" ? (source[key] as string).trim() : "");

  const simple = read("simple");
  const explanation = limitWords(read("explanation"), MAX_EXPLANATION_WORDS);
  if (!simple || !explanation) return null;

  const translation = foreign ? read("translation") || null : null;
  return { simple, translation, explanation };
}

/** Campos da explicacao na ordem em que o modelo os escreve (US-145). */
export function explanationFields(foreign: boolean): (keyof Explanation)[] {
  return foreign ? ["simple", "translation", "explanation"] : ["simple", "explanation"];
}

/* --- continuacoes (US-146) ----------------------------------------------- */

/** Pedido de continuacao: outra forma de explicar a mesma frase. */
export type FollowUp = "simples" | "exemplo";

/** Teto de cada continuacao, em palavras. */
export const FOLLOW_UP_WORDS: Record<FollowUp, number> = { simples: 40, exemplo: 50 };

/** Continuacoes por frase: uma de cada. */
export const MAX_FOLLOW_UPS = 2;

export const FOLLOW_UP_LABELS: Record<FollowUp, string> = {
  simples: "Mais simples",
  exemplo: "Dar um exemplo",
};

export function normalizeFollowUp(value: unknown): FollowUp | null {
  return value === "simples" || value === "exemplo" ? value : null;
}

/** Chave da continuacao em cache: a da explicacao mais o tipo. */
export function followUpKey(explanationKey: string, kind: FollowUp): string {
  return `${explanationKey}:${kind}`;
}

/**
 * Pedido da continuacao. Reaproveita o recorte da explicacao (a frase e o que
 * veio antes): nenhum contexto novo sai do app. A explicacao anterior, gerada
 * pelo proprio modelo, entra so para ele nao repeti-la.
 */
export function followUpPrompt(
  request: Pick<ExplainRequest, "sentence" | "before">,
  kind: FollowUp,
  previous?: Pick<Explanation, "simple" | "explanation"> | null
): string {
  const parts = [];
  if (request.before) parts.push(`Trecho anterior:\n${request.before}`);
  parts.push(`Frase:\n${request.sentence}`);
  if (previous) {
    parts.push(`Explicação já dada:\n${previous.simple}\n${previous.explanation}`);
  }
  const max = FOLLOW_UP_WORDS[kind];
  parts.push(
    kind === "simples"
      ? `A explicação não bastou. Explique a frase de forma ainda mais simples, em no máximo ${max} palavras, sem termos técnicos que não estejam na frase.`
      : `Dê um exemplo concreto, do dia a dia, que ajude a entender a frase, em no máximo ${max} palavras. Use só a frase e o trecho anterior; não suponha o que vem depois.`
  );
  return parts.join("\n\n");
}

/** Continuacao aceita: texto nao vazio, cortado no teto do tipo. */
export function parseFollowUp(raw: string, kind: FollowUp): string | null {
  const text = limitWords(raw.replace(/\s+/g, " "), FOLLOW_UP_WORDS[kind]);
  return text ? text : null;
}
