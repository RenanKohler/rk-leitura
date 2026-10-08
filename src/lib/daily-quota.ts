import "server-only";

import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";
import { todayIn } from "@/lib/goals";
import { loadSettings } from "@/lib/queries";
import { DAILY_QUOTAS, quotaKey, secondsUntilNextDay, type QuotaKind } from "@/lib/quota";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Consome uma unidade da cota diaria da conta.
 *
 * A janela do contador vai ate a meia-noite no fuso do usuario, com folga de
 * uma hora: a chave ja muda na virada, a folga so evita que a linha suma antes
 * do ultimo pedido do dia ser contado.
 */
export async function consumeDailyQuota(
  kind: QuotaKind,
  userId: string
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const timezone = (await loadSettings(userId))?.timezone ?? "UTC";
  const now = new Date();
  const remaining = secondsUntilNextDay(timezone, now);

  const result = await rateLimit(
    quotaKey(kind, userId, todayIn(timezone, now)),
    DAILY_QUOTAS[kind],
    (remaining + 3600) * 1000
  );
  return { allowed: result.allowed, retryAfterSeconds: result.allowed ? 0 : remaining };
}

/**
 * Reserva ate `wanted` unidades da cota de uma vez e devolve quantas cabem
 * (US-139). O excedente e devolvido na mesma consulta, para a contagem nunca
 * passar do teto por causa de um lote.
 */
export async function reserveDailyQuota(
  kind: QuotaKind,
  userId: string,
  wanted: number
): Promise<number> {
  if (wanted <= 0) return 0;
  const timezone = (await loadSettings(userId))?.timezone ?? "UTC";
  const now = new Date();
  const remaining = secondsUntilNextDay(timezone, now);
  const key = quotaKey(kind, userId, todayIn(timezone, now));
  const limit = DAILY_QUOTAS[kind];

  await db
    .insert(rateLimits)
    .values({ key, count: 0, resetAt: new Date(now.getTime() + (remaining + 3600) * 1000) })
    .onConflictDoNothing();

  // Soma o que cabe ate o teto e devolve a diferenca entre antes e depois.
  const result = await db.execute<{ before: number; after: number }>(sql`
    with prev as (select count from rate_limits where key = ${key} for update)
    update rate_limits
       set count = least(rate_limits.count + ${wanted}, greatest(rate_limits.count, ${limit}))
     where key = ${key}
    returning (select count from prev) as before, rate_limits.count as after`);
  const row = result.rows[0];
  return row ? Math.max(0, Number(row.after) - Number(row.before)) : 0;
}

/** Quanto de cada cota a conta ja usou hoje (US-126). */
export async function readDailyUsage(
  userId: string
): Promise<{ timezone: string; used: Record<QuotaKind, number> }> {
  const timezone = (await loadSettings(userId))?.timezone ?? "UTC";
  const day = todayIn(timezone, new Date());
  const kinds = Object.keys(DAILY_QUOTAS) as QuotaKind[];
  const rows = await db
    .select({ key: rateLimits.key, count: rateLimits.count })
    .from(rateLimits)
    .where(inArray(rateLimits.key, kinds.map((kind) => quotaKey(kind, userId, day))));
  const byKey = new Map(rows.map((row) => [row.key, row.count]));
  const used = Object.fromEntries(
    kinds.map((kind) => [kind, Math.min(DAILY_QUOTAS[kind], byKey.get(quotaKey(kind, userId, day)) ?? 0)])
  ) as Record<QuotaKind, number>;
  return { timezone, used };
}
