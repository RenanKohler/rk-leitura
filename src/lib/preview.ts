/**
 * Previa antes de ler (US-233). Funcoes puras, com teste.
 *
 * Como a sinopse (US-138), o modelo so recebe o comeco do texto: sem spoiler
 * por construcao, garantido aqui na montagem do recorte. A resposta passa
 * por `clampPreview`, que corta tamanho e quantidade e recusa o que nao
 * serve (sem as duas perguntas, nao ha previa).
 */

import { synopsisExcerpt } from "@/lib/synopsis";

/** Parte do texto enviada: os primeiros 15%, como a sinopse. */
export const PREVIEW_SHARE = 0.15;

/** Teto do recorte, em caracteres, mesmo em livro inteiro. */
export const MAX_PREVIEW_CHARS = 12_000;

/** Abaixo disso o texto se le em poucos minutos: a previa nao vale a chamada. */
export const MIN_PREVIEW_WORDS = 300;

export const MAX_FOCUS_ITEMS = 3;
export const PREVIEW_QUESTIONS = 2;
/** Teto de cada campo, em caracteres. */
export const MAX_ABOUT_CHARS = 240;
export const MAX_ITEM_CHARS = 140;
export const MAX_QUESTION_CHARS = 180;

export interface Preview {
  /** Do que trata, em uma frase. */
  about: string;
  /** Em que prestar atencao: ate 3 itens curtos. */
  focus: string[];
  /** Duas perguntas para ler buscando a resposta. */
  questions: string[];
}

export interface PreviewCandidate {
  wordCount: number;
  progressIndex: number;
  /** Fim da ultima sessao de leitura; nulo se nunca lido. */
  lastReadAt?: string | Date | null;
}

/** Texto ainda nao comecado (posicao 0, nunca lido) e longo o bastante. */
export function canAskPreview(text: PreviewCandidate): boolean {
  return (
    text.progressIndex === 0 &&
    !text.lastReadAt &&
    text.wordCount >= MIN_PREVIEW_WORDS
  );
}

/** O comeco do texto que vai ao modelo. */
export function previewExcerpt(content: string): string {
  return synopsisExcerpt(content, PREVIEW_SHARE, MAX_PREVIEW_CHARS);
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Corta no ultimo espaco antes do teto, fechando com reticencias. */
export function clampChars(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  const base = (space > max / 2 ? cut.slice(0, space) : cut).replace(/[.,;:!?…\s]+$/, "");
  return `${base}…`;
}

/** Frase mais curta que isso e abreviatura ("Sr."), nao frase. */
const MIN_SENTENCE_CHARS = 20;

/** Primeira frase: "do que trata" e uma frase so. */
export function firstSentence(value: string): string {
  for (const match of value.matchAll(/[.!?…](?=\s|$)/g)) {
    const end = match.index + 1;
    if (end >= MIN_SENTENCE_CHARS) return value.slice(0, end).trim();
  }
  return value.trim();
}

function list(raw: unknown, max: number, chars: number): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const text = clean(item);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    result.push(clampChars(text, chars));
    if (result.length === max) break;
  }
  return result;
}

/**
 * A previa pronta para mostrar, ou null quando a resposta nao serve: sem a
 * frase de abertura ou sem as duas perguntas.
 */
export function clampPreview(raw: unknown): Preview | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { about?: unknown; focus?: unknown; questions?: unknown };
  const about = clampChars(firstSentence(clean(value.about)), MAX_ABOUT_CHARS);
  if (!about) return null;
  const focus = list(value.focus, MAX_FOCUS_ITEMS, MAX_ITEM_CHARS);
  const questions = list(value.questions, PREVIEW_QUESTIONS, MAX_QUESTION_CHARS).map((question) =>
    /[?…]$/.test(question) ? question : `${question.replace(/[.!;:]+$/, "")}?`
  );
  if (questions.length < PREVIEW_QUESTIONS) return null;
  return { about, focus, questions };
}

/** Uma previa ja guardada, conferida antes de ir para a tela. */
export function isPreview(value: unknown): value is Preview {
  if (!value || typeof value !== "object") return false;
  const preview = value as Partial<Preview>;
  return (
    typeof preview.about === "string" &&
    Array.isArray(preview.focus) &&
    Array.isArray(preview.questions) &&
    preview.questions.length === PREVIEW_QUESTIONS
  );
}
