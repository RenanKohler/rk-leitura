import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiBatches, savedWords } from "@/db/schema";
import { AI_BUSY, AI_MODELS, aiClient, AiUnavailable, recordUsage } from "@/lib/ai";
import { releaseDailyQuota, reserveDailyQuota } from "@/lib/daily-quota";
import {
  batchItemEntry,
  UNSENT_BATCH,
  UNSENT_BATCH_TTL_MS,
  type BatchItemLike,
  type BatchState,
} from "@/lib/definition-batch";
import { MAX_SAVED_WORDS } from "@/lib/dictionary";
import { LOOKUP_MESSAGES, LOOKUP_SCHEMA, LOOKUP_SYSTEM, lookupPrompt } from "@/lib/word-lookup";

/**
 * Lote de definicoes pendentes pela Message Batches (US-139).
 *
 * Um lote por conta por vez. A vaga e reservada antes do envio, dentro de uma
 * trava por conta, para dois toques seguidos nao abrirem dois lotes; o
 * resultado e conferido ao abrir Palavras e no acompanhamento de hora em hora.
 */

/** Esquema do pedido, o mesmo da consulta avulsa, sem o analisador do SDK. */
const FORMAT = { type: "json_schema" as const, schema: zodOutputFormat(LOOKUP_SCHEMA).schema };

export type StartResult =
  | { status: "busy" }
  | { status: "empty" }
  | { status: "quota"; pending: number }
  | { status: "started"; batched: number; pending: number; wordIds: string[] };

const pendingFilter = (userId: string) =>
  and(eq(savedWords.userId, userId), sql`btrim(${savedWords.definition}) = ''`);

async function activeBatch(userId: string) {
  const [row] = await db
    .select()
    .from(aiBatches)
    .where(and(eq(aiBatches.userId, userId), eq(aiBatches.status, "processando")))
    .limit(1);
  return row ?? null;
}

/**
 * Envia as palavras sem definicao em um lote, ate o que cabe na cota do dia.
 *
 * A cota e reservada inteira de uma vez: as palavras que nao couberem ficam de
 * fora e a tela diz quantas (criterio 2). O consentimento (US-125) e conferido
 * pela rota antes de chegar aqui.
 */
export async function startDefinitionBatch(userId: string): Promise<StartResult> {
  // Sem chave, nada de reservar cota para um envio que nao vai acontecer.
  const client = aiClient(LOOKUP_MESSAGES);

  const words = await db
    .select({
      id: savedWords.id,
      word: savedWords.word,
      context: savedWords.context,
      language: savedWords.language,
    })
    .from(savedWords)
    .where(pendingFilter(userId))
    .orderBy(asc(savedWords.createdAt))
    .limit(MAX_SAVED_WORDS);

  // Reserva a vaga do lote sob uma trava da conta: a conferencia e a reserva
  // sao uma coisa so, entao dois pedidos simultaneos nao abrem dois lotes.
  const claim = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai_batch:${userId}`}))`);
    const [busy] = await tx
      .select({ id: aiBatches.id })
      .from(aiBatches)
      .where(and(eq(aiBatches.userId, userId), eq(aiBatches.status, "processando")))
      .limit(1);
    if (busy) return { status: "busy" as const };
    if (words.length === 0) return { status: "empty" as const };

    const reserved = await reserveDailyQuota("dicionario", userId, words.length);
    if (reserved === 0) return { status: "quota" as const };

    const chosen = words.slice(0, reserved);
    const [row] = await tx
      .insert(aiBatches)
      .values({ userId, batchId: UNSENT_BATCH, wordIds: chosen.map((word) => word.id) })
      .returning({ id: aiBatches.id });
    return { status: "claimed" as const, rowId: row!.id, chosen };
  });

  if (claim.status === "busy" || claim.status === "empty") return { status: claim.status };
  if (claim.status === "quota") return { status: "quota", pending: words.length };

  let batch;
  try {
    batch = await client.messages.batches.create({
      // Sem `fallbacks` nem betas: a Batches nao aceita. Uma recusa vira item
      // sem definicao (criterio 4).
      requests: claim.chosen.map((word) => ({
        custom_id: word.id,
        params: {
          model: AI_MODELS.dicionario,
          // No Haiku o raciocinio conta no teto, como na consulta avulsa.
          max_tokens: 2000,
          system: LOOKUP_SYSTEM,
          output_config: { effort: "low", format: FORMAT },
          messages: [
            { role: "user", content: lookupPrompt(word.word, word.context ?? "", word.language) },
          ],
        },
      })),
    });
  } catch (error) {
    // O lote nem foi criado: a vaga e a cota reservada voltam.
    await db.delete(aiBatches).where(eq(aiBatches.id, claim.rowId));
    await releaseDailyQuota("dicionario", userId, claim.chosen.length).catch(() => undefined);
    if (error instanceof Anthropic.RateLimitError) throw new AiUnavailable(AI_BUSY);
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AiUnavailable(LOOKUP_MESSAGES.notConfigured);
    }
    console.error("[ia] lote de definicoes falhou:", error);
    throw new AiUnavailable(LOOKUP_MESSAGES.failure);
  }

  await db.update(aiBatches).set({ batchId: batch.id }).where(eq(aiBatches.id, claim.rowId));
  return {
    status: "started",
    batched: claim.chosen.length,
    pending: words.length,
    wordIds: claim.chosen.map((word) => word.id),
  };
}

/**
 * Confere um lote e, se ele terminou, grava as definicoes que vieram.
 *
 * Devolve true quando o lote saiu de "processando". O lote e marcado como
 * concluido antes de os itens serem gravados, para uma segunda conferencia ao
 * mesmo tempo (a pagina e o acompanhamento) nao registrar o uso duas vezes.
 */
async function settle(row: typeof aiBatches.$inferSelect): Promise<boolean> {
  if (row.batchId === UNSENT_BATCH) {
    // Reserva cujo envio caiu no meio: libera a vaga depois de um tempo.
    if (Date.now() - row.createdAt.getTime() < UNSENT_BATCH_TTL_MS) return false;
    await db.delete(aiBatches).where(eq(aiBatches.id, row.id));
    return true;
  }

  const client = aiClient(LOOKUP_MESSAGES);
  const batch = await client.messages.batches.retrieve(row.batchId);
  if (batch.processing_status !== "ended") return false;

  const [claimed] = await db
    .update(aiBatches)
    .set({ status: "concluido", endedAt: new Date() })
    .where(and(eq(aiBatches.id, row.id), eq(aiBatches.status, "processando")))
    .returning({ id: aiBatches.id });
  if (!claimed) return true;

  try {
    await applyResults(client, row);
  } catch (error) {
    // Falhou no meio da leitura: volta a processando para a proxima conferencia.
    await db
      .update(aiBatches)
      .set({ status: "processando", endedAt: null })
      .where(eq(aiBatches.id, row.id));
    throw error;
  }
  return true;
}

async function applyResults(client: Anthropic, row: typeof aiBatches.$inferSelect) {
  const words = await db
    .select({ id: savedWords.id, word: savedWords.word, language: savedWords.language })
    .from(savedWords)
    .where(pendingFilter(row.userId));
  // Palavra apagada ou definida a mao enquanto o lote rodava fica de fora.
  const byId = new Map(words.map((word) => [word.id, word]));
  const inBatch = new Set(row.wordIds);

  for await (const item of await client.messages.batches.results(row.batchId)) {
    if (item.result.type === "succeeded") {
      await recordUsage(
        row.userId,
        "dicionario",
        item.result.message.model,
        item.result.message.usage,
        { batch: true }
      );
    }

    const word = inBatch.has(item.custom_id) ? byId.get(item.custom_id) : undefined;
    if (!word) continue;
    const entry = batchItemEntry(item as BatchItemLike, word.word, word.language);
    if (!entry) continue;

    await db
      .update(savedWords)
      .set({
        base: entry.base,
        kind: entry.kind,
        definition: entry.definition,
        translation: entry.translation ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(savedWords.id, word.id), pendingFilter(row.userId)));
  }
}

/**
 * Estado do lote da conta, conferindo o andamento antes (ao abrir Palavras).
 *
 * Uma falha ao consultar a API nao derruba a pagina: o lote continua como
 * estava e a proxima abertura (ou o acompanhamento) confere de novo.
 */
export async function refreshDefinitionBatch(userId: string): Promise<BatchState> {
  const row = await activeBatch(userId);
  if (!row) return { processing: false, wordIds: [] };
  try {
    if (await settle(row)) return { processing: false, wordIds: [] };
  } catch (error) {
    console.error("[ia] conferencia do lote falhou:", error instanceof Error ? error.message : error);
  }
  return { processing: true, wordIds: row.wordIds };
}

/** Confere todos os lotes em processamento (acompanhamento de hora em hora). */
export async function settleDefinitionBatches(
  deadline: number
): Promise<{ checked: number; ended: number }> {
  const report = { checked: 0, ended: 0 };
  const rows = await db
    .select()
    .from(aiBatches)
    .where(eq(aiBatches.status, "processando"))
    .orderBy(asc(aiBatches.createdAt));

  for (const row of rows) {
    if (Date.now() > deadline) break;
    report.checked += 1;
    try {
      if (await settle(row)) report.ended += 1;
    } catch (error) {
      if (error instanceof AiUnavailable) break;
      console.error("[acompanhamento] falha no lote:", error instanceof Error ? error.message : error);
    }
  }
  return report;
}

/** Lotes concluidos ha mais de 30 dias nao servem para nada: so a linha. */
export async function pruneDefinitionBatches(now: Date): Promise<void> {
  await db
    .delete(aiBatches)
    .where(
      and(
        eq(aiBatches.status, "concluido"),
        lt(aiBatches.endedAt, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
      )
    );
}
