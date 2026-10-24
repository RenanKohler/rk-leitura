import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, getPool } from "@/db";
import { texts, users } from "@/db/schema";
import { loadTimeWindow } from "@/lib/queries";
import { countWords } from "@/lib/reading";

/** Perfil de ritmo gravado e apagado pelo banco (US-209). */

const created: string[] = [];

afterAll(async () => {
  for (const id of created) await db.delete(users).where(eq(users.id, id));
  await getPool().end();
});

const paragraph = (seed: string) =>
  `${seed} acompanha o argumento, guarda o que veio antes e relaciona com o que vem depois. `.repeat(4);

describe("perfil de ritmo no banco", () => {
  it("o tempo livre grava o perfil, e editar o texto o apaga", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `integracao-${randomUUID()}@exemplo.com`, passwordHash: "x" })
      .returning({ id: users.id });
    created.push(user!.id);
    const content = [paragraph("O leitor"), paragraph("A leitora"), paragraph("Quem lê")].join("\n\n");
    const [text] = await db
      .insert(texts)
      .values({ userId: user!.id, title: "Perfil", content, wordCount: countWords(content) })
      .returning({ id: texts.id });

    const window = await loadTimeWindow(user!.id, 5);
    expect(window.suggestions.map((item) => item.textId)).toEqual([text!.id]);

    const stored = async () =>
      (await db.select({ profile: texts.paceProfile }).from(texts).where(eq(texts.id, text!.id)))[0]!
        .profile;
    expect(await stored()).toMatchObject({ v: 1 });

    // Mudar o progresso nao mexe no perfil; mudar o conteudo apaga.
    await db.update(texts).set({ progressIndex: 10 }).where(eq(texts.id, text!.id));
    expect(await stored()).not.toBeNull();
    await db.update(texts).set({ content: `${content}\n\nMais um parágrafo.` }).where(eq(texts.id, text!.id));
    expect(await stored()).toBeNull();

    // A consulta seguinte refaz.
    await loadTimeWindow(user!.id, 5);
    expect(await stored()).not.toBeNull();
  });
});
