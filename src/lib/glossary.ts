/**
 * Glossario de conceitos do texto (US-164). Funcoes puras, com teste.
 *
 * O glossario so usa o trecho ate a posicao de leitura: o recorte enviado
 * termina no corte da faixa de 1.000 palavras, e cada termo devolvido precisa
 * aparecer literalmente nesse trecho. A posicao mostrada e a da primeira
 * ocorrencia no texto, calculada aqui e nao pedida ao modelo.
 */

import { findPhrase, phraseKeys } from "@/lib/passage-match";
import { isConcluded, type ReadingProgress } from "@/lib/study-cards";

/** Palavras lidas para haver glossario. */
export const MIN_GLOSSARY_WORDS = 500;
/** Faixa de posicao que compartilha o mesmo glossario guardado. */
export const GLOSSARY_BUCKET = 1_000;
export const MAX_TERMS = 30;
export const MAX_DEFINITION_WORDS = 30;
/** Termo e nome, nao frase: acima disso nao entra. */
export const MAX_TERM_WORDS = 6;

export const GLOSSARY_TOO_SOON = "Leia pelo menos 500 palavras para gerar o glossário.";

export interface GlossaryEntry {
  term: string;
  definition: string;
  /** Primeira ocorrencia do termo no texto, `[start, end)`. */
  start: number;
  end: number;
}

/**
 * Ate onde vai o trecho do glossario, ou null quando leu pouco. Texto
 * concluido usa o texto inteiro; nos demais o corte e o comeco da faixa de
 * 1.000 palavras (no minimo as 500 primeiras), entao reabrir sem avancar uma
 * faixa encontra o glossario guardado, e nenhum termo vem depois da posicao.
 */
export function glossaryCut(progress: ReadingProgress): number | null {
  const { wordCount } = progress;
  if (wordCount <= 0) return null;
  if (isConcluded(progress)) return wordCount >= MIN_GLOSSARY_WORDS ? wordCount : null;
  const read = Math.min(wordCount, Math.trunc(progress.progressIndex) + 1);
  if (read < MIN_GLOSSARY_WORDS) return null;
  return Math.max(MIN_GLOSSARY_WORDS, Math.floor(read / GLOSSARY_BUCKET) * GLOSSARY_BUCKET);
}

/** Chave do glossario guardado: texto, impressao do conteudo e corte. */
export function glossaryKey(textId: string, fingerprint: string, cut: number): string {
  return `${textId}:${fingerprint}:${cut}`;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function wordsOf(value: string): number {
  return value ? value.split(" ").length : 0;
}

/**
 * Resposta do modelo validada contra o texto.
 *
 * `sent` e o intervalo enviado (o termo precisa aparecer ali) e `cut` o fim
 * do que foi lido: a primeira ocorrencia e procurada de 0 ate o corte. Termo
 * repetido, definicao vazia ou longa demais e termo que nao aparece saem.
 * Ordem alfabetica, ate 30.
 */
export function validGlossary(
  raw: unknown,
  keys: string[],
  sent: { from: number; to: number },
  cut: number
): GlossaryEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { terms?: unknown }).terms)
      ? (raw as { terms: unknown[] }).terms
      : [];
  const seen = new Set<string>();
  const entries: GlossaryEntry[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const term = clean((item as { term?: unknown }).term).replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "");
    const definition = clean((item as { definition?: unknown }).definition);
    const size = phraseKeys(term).length;
    if (size === 0 || size > MAX_TERM_WORDS) continue;
    if (!definition || wordsOf(definition) > MAX_DEFINITION_WORDS) continue;
    const key = phraseKeys(term).join(" ");
    if (seen.has(key)) continue;
    if (!findPhrase(keys, term, sent.from, Math.min(sent.to, cut))) continue;
    const first = findPhrase(keys, term, 0, cut);
    if (!first) continue;
    seen.add(key);
    entries.push({ term, definition, start: first.start, end: first.end });
  }

  return sortTerms(entries).slice(0, MAX_TERMS);
}

/** Ordem alfabetica do portugues: acento e maiuscula nao separam. */
export function sortTerms<T extends { term: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => a.term.localeCompare(b.term, "pt-BR", { sensitivity: "base" }));
}

/** Glossario lido do banco, ou null quando o formato nao confere. */
export function parseStoredGlossary(raw: unknown): GlossaryEntry[] | null {
  if (!raw || typeof raw !== "object") return null;
  const terms = (raw as { terms?: unknown }).terms;
  if (!Array.isArray(terms)) return null;
  const entries: GlossaryEntry[] = [];
  for (const item of terms) {
    const entry = item as Partial<GlossaryEntry> | null;
    if (
      !entry ||
      typeof entry.term !== "string" ||
      typeof entry.definition !== "string" ||
      !Number.isInteger(entry.start) ||
      !Number.isInteger(entry.end)
    ) {
      continue;
    }
    entries.push({ term: entry.term, definition: entry.definition, start: entry.start!, end: entry.end! });
  }
  return entries;
}
