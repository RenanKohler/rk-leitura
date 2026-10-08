/**
 * Custo estimado das chamadas ao modelo (US-124).
 *
 * Funcoes puras, para a conta poder ser testada sem rede. Os precos sao os
 * da pagina de precos da Anthropic em outubro de 2026, em dolares por milhao
 * de tokens; quando mudarem, muda so esta tabela.
 */

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
}

/** Escrita no cache de 5 minutos: 1,25x o preco de entrada. */
export const CACHE_WRITE_FACTOR = 1.25;
/** Message Batches: metade do preco em todos os tokens. */
export const BATCH_FACTOR = 0.5;

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** Modelo desconhecido (um fallback novo, por exemplo) conta pelo preco do Opus 5.5. */
const DEFAULT_PRICE = MODEL_PRICES["claude-opus-5-5"];

export interface UsageCounts {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  batch?: boolean;
}

/** Custo estimado, em dolares. */
export function estimateCost(usage: UsageCounts): number {
  const price = MODEL_PRICES[usage.model] ?? DEFAULT_PRICE;
  const perToken =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheReadTokens * price.cacheRead +
    usage.cacheWriteTokens * price.input * CACHE_WRITE_FACTOR;
  const cost = perToken / 1_000_000;
  return usage.batch ? cost * BATCH_FACTOR : cost;
}
