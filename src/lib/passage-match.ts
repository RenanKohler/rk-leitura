/**
 * Achar no texto um termo ou citacao devolvido pelo modelo (US-164 a US-167).
 * Funcoes puras, com teste.
 *
 * O modelo devolve texto; o leitor precisa de posicao. A conversao e feita
 * aqui, palavra por palavra, contra a lista corrida do texto: maiusculas e a
 * pontuacao colada a palavra nao contam, o resto precisa ser igual. O que nao
 * aparece literalmente no intervalo pedido e descartado - e a garantia de que
 * cada termo ou citacao mostrada existe no texto, e no trecho que foi enviado.
 */

import type { Span } from "@/lib/highlights";

/** Citacao curta demais casa em qualquer lugar; longa demais nao e citacao. */
export const MIN_QUOTE_WORDS = 3;
export const MAX_QUOTE_WORDS = 80;

/** Forma comparavel de uma palavra: minuscula, sem a pontuacao das pontas. */
export function matchKey(word: string): string {
  return word
    .normalize("NFC")
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "");
}

/** Chaves de todas as palavras do texto, calculadas uma vez por pedido. */
export function matchKeys(words: string[]): string[] {
  return words.map(matchKey);
}

/** Chaves de um termo ou citacao, sem os pedacos que sao so pontuacao. */
export function phraseKeys(phrase: string): string[] {
  return phrase
    .replace(/[…]|\.{3}/g, " ")
    .split(/\s+/)
    .map(matchKey)
    .filter((key) => key.length > 0);
}

/**
 * Primeira ocorrencia da frase inteiramente dentro de [from, to), ou null.
 * Palavras do texto que sao so pontuacao ("—") sao puladas nos dois lados.
 */
export function findPhrase(keys: string[], phrase: string, from = 0, to = keys.length): Span | null {
  const target = phraseKeys(phrase);
  if (target.length === 0) return null;
  const lower = Math.max(0, Math.trunc(from));
  const upper = Math.min(keys.length, Math.trunc(to));

  for (let start = lower; start < upper; start += 1) {
    if (keys[start] !== target[0]) continue;
    let position = start + 1;
    let matched = 1;
    while (matched < target.length && position < upper) {
      const key = keys[position]!;
      if (key === "") {
        position += 1;
        continue;
      }
      if (key !== target[matched]) break;
      matched += 1;
      position += 1;
    }
    if (matched === target.length) return { start, end: position };
  }
  return null;
}

/** Citacao limpa: sem aspas nas pontas e com espacos simples. */
export function cleanQuote(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "")
    .trim();
}

/**
 * Posicao de uma citacao dentro de [from, to), ou null quando ela nao aparece
 * literalmente ali, ou e curta ou longa demais para servir de citacao.
 */
export function findQuote(keys: string[], raw: unknown, from: number, to: number): Span | null {
  const quote = cleanQuote(raw);
  const size = phraseKeys(quote).length;
  if (size < MIN_QUOTE_WORDS || size > MAX_QUOTE_WORDS) return null;
  return findPhrase(keys, quote, from, to);
}

/** Trecho do texto no intervalo, como o leitor mostra. */
export function spanText(words: string[], span: Span): string {
  return words.slice(span.start, span.end).join(" ");
}
