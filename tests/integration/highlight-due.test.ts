import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, getPool } from "@/db";
import { highlights, texts, users } from "@/db/schema";
import { highlightDue } from "@/lib/learning-queries";

/** Destaque nunca revisado vence no dia seguinte, no fuso do leitor (US-199). */

const created: string[] = [];

afterAll(async () => {
  for (const id of created) await db.delete(users).where(eq(users.id, id));
  await getPool().end();
});

describe("vencimento do destaque no banco", () => {
  it("o destaque das 22h vence na manha seguinte do leitor", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `integracao-${randomUUID()}@exemplo.com`, passwordHash: "x" })
      .returning({ id: users.id });
    created.push(user!.id);
    const [text] = await db
      .insert(texts)
      .values({ userId: user!.id, title: "T", content: "um dois tres", wordCount: 3 })
      .returning({ id: texts.id });
    // 22h de 23/10 em Sao Paulo.
    await db.insert(highlights).values({
      userId: user!.id,
      textId: text!.id,
      startIndex: 0,
      endIndex: 1,
      createdAt: new Date("2026-10-24T01:00:00Z"),
    });

    const due = async (today: string) =>
      (
        await db
          .select({ id: highlights.id })
          .from(highlights)
          .where(and(eq(highlights.userId, user!.id), highlightDue(today, "America/Sao_Paulo")))
      ).length;

    // Mesmo dia da criacao: ainda nao.
    expect(await due("2026-10-23")).toBe(0);
    // Manha seguinte, menos de 24 horas depois: vencido.
    expect(await due("2026-10-24")).toBe(1);
  });
});
