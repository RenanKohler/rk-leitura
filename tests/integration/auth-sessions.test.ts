import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, getPool } from "@/db";
import { authSessions, users } from "@/db/schema";
import { pruneAuthSessions } from "@/lib/auth";

/** Limpeza das linhas de aparelho pelo cron (US-188). */

const created: string[] = [];

afterAll(async () => {
  for (const id of created) await db.delete(users).where(eq(users.id, id));
  await getPool().end();
});

describe("limpeza de aparelhos", () => {
  it("apaga revogadas e vencidas ha mais de 30 dias e mantem o resto", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `integracao-${randomUUID()}@exemplo.com`, passwordHash: "x" })
      .returning({ id: users.id });
    created.push(user!.id);
    const now = new Date();
    const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const rows = await db
      .insert(authSessions)
      .values([
        { userId: user!.id, userAgent: "ativa", issuedAt: daysAgo(1) },
        { userId: user!.id, userAgent: "vencida-recente", issuedAt: daysAgo(20) },
        { userId: user!.id, userAgent: "vencida-antiga", issuedAt: daysAgo(40) },
        { userId: user!.id, userAgent: "revogada-recente", issuedAt: daysAgo(2), revokedAt: daysAgo(5) },
        { userId: user!.id, userAgent: "revogada-antiga", issuedAt: daysAgo(2), revokedAt: daysAgo(31) },
      ])
      .returning({ id: authSessions.id });
    expect(rows).toHaveLength(5);

    expect(await pruneAuthSessions(now)).toBeGreaterThanOrEqual(2);
    const left = await db
      .select({ agent: authSessions.userAgent })
      .from(authSessions)
      .where(eq(authSessions.userId, user!.id));
    expect(left.map((row) => row.agent).sort()).toEqual(["ativa", "revogada-recente", "vencida-recente"]);
  });
});
