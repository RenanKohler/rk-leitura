/**
 * Analogia para um cartao errado (US-168). Funcoes puras, com teste.
 *
 * O pedido leva so a frente, o verso e o trecho de origem do cartao: nada do
 * resto do texto, nem a analogia guardada antes. A regra fica aqui, na
 * montagem, e nao pedida ao modelo.
 */

import { limitWords } from "@/lib/explain";

/** Teto da analogia, em palavras. */
export const MAX_ANALOGY_WORDS = 50;

/** Teto do trecho de origem enviado, em palavras. */
export const MAX_ANALOGY_SOURCE_WORDS = 300;

export const ANALOGY_FAILURE = "Não consegui explicar de outro jeito agora.";

export interface AnalogyRequest {
  front: string;
  back: string;
  /** Trecho de origem do cartao, ja cortado do texto. */
  source: string;
}

/** Recorte enviado: so os tres campos, com o trecho limitado. */
export function analogyRequest(card: {
  front: string;
  back: string;
  source: string;
}): AnalogyRequest {
  const words = card.source.trim().split(/\s+/).filter(Boolean);
  return {
    front: card.front.trim(),
    back: card.back.trim(),
    source: words.slice(0, MAX_ANALOGY_SOURCE_WORDS).join(" "),
  };
}

export function analogyPrompt(request: AnalogyRequest): string {
  const parts = [`Frente do cartão:\n${request.front}`, `Verso do cartão:\n${request.back}`];
  if (request.source) parts.push(`Trecho de origem:\n${request.source}`);
  parts.push(
    `A pessoa errou este cartão. Explique o conceito de outro jeito, com uma analogia ou um exemplo concreto do dia a dia, em no máximo ${MAX_ANALOGY_WORDS} palavras. Responda só com a analogia.`
  );
  return parts.join("\n\n");
}

/** Palavras do texto enviadas (US-144): o trecho de origem. */
export function analogyWordsSent(request: AnalogyRequest): number {
  return request.source ? request.source.split(/\s+/).length : 0;
}

/** Analogia aceita: texto nao vazio, cortado no teto. */
export function parseAnalogy(raw: string): string | null {
  const text = limitWords(raw.replace(/\s+/g, " "), MAX_ANALOGY_WORDS);
  return text ? text : null;
}

/** Analogia que o leitor pede para guardar: a mesma regra, mais o teto do lado do cartao. */
export function storedAnalogy(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = parseAnalogy(value);
  return text && text.length <= 600 ? text : null;
}
