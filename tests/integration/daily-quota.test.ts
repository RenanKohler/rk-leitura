import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like, sql } from "drizzle-orm";
import { db, getPool } from "@/db";
import { aiUsage, rateLimits, users } from "@/db/schema";
import { readDailyUsage, releaseDailyQuota, reserveDailyQuota } from "@/lib/daily-quota";
import { DAILY_QUOTAS } from "@/lib/quota";
import { pruneAiUsage, usageCutoff } from "@/lib/ai-retention";

/**
 * Cota diaria e retencao do uso de IA contra o Postgres (US-206, US-207).
 * Cada teste usa uma conta propria, apagada no fim.
 */

const created: string[] = [];

async function newUser(): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email: `integracao-${randomUUID()}@exemplo.com`, passwordHash: "x" })
    .returning({ id: users.id });
  created.push(row!.id);
  return row!.id;
}

async function counter(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(like(rateLimits.key, `dicionario-dia:${userId}:%`));
  return row?.count ?? 0;
}

beforeAll(async () => {
  await db.execute(sql`select 1`);
});

afterAll(async () => {
  for (const id of created) {
    await db.delete(rateLimits).where(like(rateLimits.key, `%:${id}:%`));
    await db.delete(users).where(eq(users.id, id));
  }
  await getPool().end();
});

describe("reserva e devolucao no banco", () => {
  it("reserva ate o teto e devolve so o que coube", async () => {
    const userId = await newUser();
    const limit = DAILY_QUOTAS.dicionario;

    expect(await reserveDailyQuota("dicionario", userId, limit - 5)).toBe(limit - 5);
    expect(await reserveDailyQuota("dicionario", userId, 10)).toBe(5);
    expect(await reserveDailyQuota("dicionario", userId, 1)).toBe(0);
    expect(await counter(userId)).toBe(limit);
  });

  it("a devolucao libera unidades e nunca passa de zero", async () => {
    const userId = await newUser();
    await reserveDailyQuota("dicionario", userId, 12);
    await releaseDailyQuota("dicionario", userId, 5);
    expect(await counter(userId)).toBe(7);

    await releaseDailyQuota("dicionario", userId, 50);
    expect(await counter(userId)).toBe(0);
    expect((await readDailyUsage(userId)).used.dicionario).toBe(0);
  });

  it("reservas simultaneas nao passam do teto", async () => {
    const userId = await newUser();
    const limit = DAILY_QUOTAS.dicionario;
    const granted = await Promise.all(
      Array.from({ length: 8 }, () => reserveDailyQuota("dicionario", userId, 40))
    );
    expect(granted.reduce((sum, value) => sum + value, 0)).toBe(limit);
    expect(await counter(userId)).toBe(limit);
  });
});

describe("retencao do uso de IA", () => {
  it("apaga so as linhas com mais de 400 dias", async () => {
    const userId = await newUser();
    const now = new Date();
    const cutoff = usageCutoff(now);
    const day = 24 * 60 * 60 * 1000;
    await db.insert(aiUsage).values([
      { userId, feature: "resumo", model: "m", createdAt: new Date(cutoff.getTime() - day) },
      { userId, feature: "resumo", model: "m", createdAt: new Date(cutoff.getTime() - 30 * day) },
      { userId, feature: "resumo", model: "m", createdAt: new Date(cutoff.getTime() + day) },
      { userId, feature: "resumo", model: "m", createdAt: now },
    ]);

    await pruneAiUsage(now, Date.now() + 10_000);

    const rows = await db
      .select({ createdAt: aiUsage.createdAt })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, userId)));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.createdAt >= cutoff)).toBe(true);
  });
});
