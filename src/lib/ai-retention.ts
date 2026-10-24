import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Retencao do registro de uso da IA (US-206).
 *
 * O `ai_usage` ganha uma linha por chamada e nunca encolhia; no banco
 * gratuito isso pesa no historico de envios e na exclusao da conta. Linhas
 * com mais de 400 dias saem em lotes pelo cron de acompanhamento - o
 * relatorio de uso e o historico olham bem menos que isso.
 */
export const AI_USAGE_RETENTION_DAYS = 400;
export const AI_USAGE_PRUNE_BATCH = 5_000;

/** Linhas criadas antes deste instante saem. */
export function usageCutoff(now: Date): Date {
  return new Date(now.getTime() - AI_USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Apaga as linhas vencidas, um lote por vez, ate acabar ou o prazo chegar.
 * Devolve quantas saiu.
 */
export async function pruneAiUsage(now: Date, deadline: number): Promise<number> {
  const cutoff = usageCutoff(now).toISOString();
  let removed = 0;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      delete from ai_usage
       where id in (select id from ai_usage where created_at < ${cutoff} limit ${AI_USAGE_PRUNE_BATCH})`);
    const count = result.rowCount ?? 0;
    removed += count;
    if (count < AI_USAGE_PRUNE_BATCH) break;
  }
  return removed;
}
