/**
 * Regras puras do lote de definicoes pendentes (US-139).
 *
 * O lote vai pela Message Batches: metade do preco, resposta em minutos ou
 * horas, em qualquer ordem. Por isso o `custom_id` de cada pedido e o id da
 * palavra guardada, e o que volta e lido item por item aqui.
 *
 * Sem dependencia de servidor: os testes cobrem estas funcoes direto.
 */

import { parseEntry, type WordEntry } from "@/lib/dictionary";
import { DEFAULT_LANGUAGE } from "@/lib/language";

/** Palavra guardada sem definicao (PROD-6): e o que o lote busca. */
export function isPendingDefinition(definition: string): boolean {
  return definition.trim().length === 0;
}

/** Lote da conta, para a tela mostrar "Buscando" nas palavras dele. */
export interface BatchState {
  processing: boolean;
  wordIds: string[];
}

/** Lote sem id ainda: a vaga foi reservada, mas o envio nao terminou. */
export const UNSENT_BATCH = "";

/** Reserva de vaga que ficou para tras (o envio caiu no meio) e liberada depois disso. */
export const UNSENT_BATCH_TTL_MS = 10 * 60 * 1000;

/** O que interessa de um item do resultado, no formato da API. */
export interface BatchItemLike {
  custom_id: string;
  result:
    | {
        type: "succeeded";
        message: {
          stop_reason: string | null;
          content: { type: string; text?: string }[];
        };
      }
    | { type: "errored" | "canceled" | "expired" };
}

/**
 * Definicao de um item do lote, ou null.
 *
 * Erro, cancelamento, expiracao (24 horas) e recusa voltam null: a palavra
 * continua sem definicao e pode ser buscada de novo, uma a uma. Uma resposta
 * que nao casa com o esquema tambem - o lote nao tem como pedir de novo.
 */
export function batchItemEntry(
  item: BatchItemLike,
  word: string,
  language: string
): WordEntry | null {
  if (item.result.type !== "succeeded") return null;
  const { message } = item.result;
  if (message.stop_reason === "refusal") return null;

  const text = message.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  const entry = parseEntry(raw, word);
  if (!entry) return null;
  // Mesma regra da consulta avulsa: palavra portuguesa nao tem traducao.
  return language === DEFAULT_LANGUAGE ? { ...entry, translation: null } : entry;
}

/** Aviso depois de enviar o lote, com o que ficou de fora pela cota (criterio 2). */
export function batchStartNotice(batched: number, pending: number): string {
  const sent =
    batched === 1 ? "1 palavra está sendo buscada." : `${batched} palavras estão sendo buscadas.`;
  const left = pending - batched;
  if (left <= 0) return sent;
  const out =
    left === 1
      ? "1 ficou de fora: a cota do dicionário de hoje acabou."
      : `${left} ficaram de fora: a cota do dicionário de hoje acabou.`;
  return `${sent} ${out}`;
}
