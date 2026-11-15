import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, getPool } from "@/db";
import { readingSessions, texts, users } from "@/db/schema";
import { loadLibrary } from "@/lib/queries";
import type { LibraryOrder } from "@/lib/library";

/**
 * Ordem da biblioteca no banco (US-230): a ultima leitura e o fim da sessao
 * mais recente do texto, e quem nunca foi lido entra pela data de importacao.
 */

const created: string[] = [];

afterAll(async () => {
  for (const id of created) await db.delete(users).where(eq(users.id, id));
  await getPool().end();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);

async function newUser(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: `integracao-${randomUUID()}@exemplo.com`, passwordHash: "x" })
    .returning({ id: users.id });
  created.push(user!.id);
  return user!.id;
}

async function addText(
  userId: string,
  title: string,
  importedAt: Date,
  extra: Partial<typeof texts.$inferInsert> = {}
): Promise<string> {
  const [text] = await db
    .insert(texts)
    .values({
      userId,
      title,
      content: "um dois tres quatro cinco",
      wordCount: 5,
      createdAt: importedAt,
      // De proposito mais recente que tudo: `updated_at` anda com edicao,
      // arquivo e reprocessamento, e nao pode decidir a ordem.
      updatedAt: new Date(),
      ...extra,
    })
    .returning({ id: texts.id });
  return text!.id;
}

async function read(userId: string, textId: string, at: Date) {
  await db
    .insert(readingSessions)
    .values({ userId, textId, wpm: 300, wordsRead: 3, durationMs: 1000, createdAt: at });
}

/** Titulos dos itens, na ordem da lista. */
async function titles(userId: string, order?: LibraryOrder): Promise<string[]> {
  const { items } = await loadLibrary(userId, 1, 20, order ? { order } : {});
  return items.map((item) => (item.kind === "serie" ? item.title : item.text.title));
}

describe("ordem da biblioteca no banco", () => {
  it("sem leitura nenhuma, vale a data de importacao nas duas ordens", async () => {
    const userId = await newUser();
    await addText(userId, "Antigo", ago(3 * DAY));
    await addText(userId, "Do meio", ago(2 * DAY));
    await addText(userId, "Recente", ago(DAY));

    expect(await titles(userId, "leitura")).toEqual(["Recente", "Do meio", "Antigo"]);
    expect(await titles(userId, "importacao")).toEqual(["Recente", "Do meio", "Antigo"]);
  });

  it("o lido por ultimo sobe; a ordem de importacao continua a de antes", async () => {
    const userId = await newUser();
    const antigo = await addText(userId, "Antigo", ago(3 * DAY));
    const meio = await addText(userId, "Do meio", ago(2 * DAY));
    await addText(userId, "Recente", ago(DAY));

    await read(userId, meio, ago(5 * HOUR));
    // Duas sessoes no mesmo texto: vale a mais recente.
    await read(userId, antigo, ago(8 * HOUR));
    await read(userId, antigo, ago(HOUR));

    // Sem ordem informada vale o padrao, a ultima leitura.
    expect(await titles(userId)).toEqual(["Antigo", "Do meio", "Recente"]);
    expect(await titles(userId, "leitura")).toEqual(["Antigo", "Do meio", "Recente"]);
    expect(await titles(userId, "importacao")).toEqual(["Recente", "Do meio", "Antigo"]);
  });

  it("texto importado depois da ultima leitura aparece no topo", async () => {
    const userId = await newUser();
    const lido = await addText(userId, "Lido ontem", ago(10 * DAY));
    await read(userId, lido, ago(DAY));
    await addText(userId, "Acabou de chegar", ago(HOUR));
    await addText(userId, "Parado ha uma semana", ago(7 * DAY));

    expect(await titles(userId, "leitura")).toEqual([
      "Acabou de chegar",
      "Lido ontem",
      "Parado ha uma semana",
    ]);
  });

  it("na serie vale a leitura mais recente entre os capitulos", async () => {
    const userId = await newUser();
    const serie = { seriesKey: `serie-${randomUUID()}`, seriesTitle: "A serie" };
    await addText(userId, "A serie - Capitulo 1", ago(9 * DAY), { ...serie, chapter: 1 });
    const segundo = await addText(userId, "A serie - Capitulo 2", ago(9 * DAY), {
      ...serie,
      chapter: 2,
    });
    const solto = await addText(userId, "Texto solto", ago(2 * DAY));
    await read(userId, solto, ago(6 * HOUR));

    // Antes de ler a serie, ela fica atras: entrou ha nove dias.
    expect(await titles(userId, "leitura")).toEqual(["Texto solto", "A serie"]);

    await read(userId, segundo, ago(HOUR));
    expect(await titles(userId, "leitura")).toEqual(["A serie", "Texto solto"]);
    expect(await titles(userId, "importacao")).toEqual(["Texto solto", "A serie"]);
  });
});
