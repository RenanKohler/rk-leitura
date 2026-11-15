import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, getPool } from "@/db";
import { texts, users } from "@/db/schema";
import { loadSeriesChapters } from "@/lib/series-queries";

/**
 * Capitulos da serie no banco (US-226): a lista que a folha Navegar do leitor
 * mostra tem o mesmo recorte e a mesma ordem do cartao da serie na biblioteca.
 */

const created: string[] = [];

afterAll(async () => {
  for (const id of created) await db.delete(users).where(eq(users.id, id));
  await getPool().end();
});

const DAY = 24 * 3_600_000;
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
  extra: Partial<typeof texts.$inferInsert> = {}
): Promise<string> {
  const [text] = await db
    .insert(texts)
    .values({ userId, title, content: "um dois tres quatro cinco", wordCount: 5, ...extra })
    .returning({ id: texts.id });
  return text!.id;
}

describe("capitulos da serie no banco", () => {
  it("texto solto nao tem capitulos", async () => {
    const userId = await newUser();
    await addText(userId, "Texto solto");

    expect(await loadSeriesChapters(userId, null)).toEqual([]);
    expect(await loadSeriesChapters(userId, "")).toEqual([]);
  });

  it("vem na ordem dos capitulos, nao na de importacao", async () => {
    const userId = await newUser();
    const seriesKey = `serie-${randomUUID()}`;
    const serie = { seriesKey, seriesTitle: "O livro" };
    const terceiro = await addText(userId, "A volta", { ...serie, chapter: 3, createdAt: ago(3 * DAY) });
    const primeiro = await addText(userId, "A partida", { ...serie, chapter: 1, createdAt: ago(2 * DAY) });
    const segundo = await addText(userId, "O mar aberto", {
      ...serie,
      chapter: 2,
      createdAt: ago(DAY),
      progressIndex: 3,
    });

    const chapters = await loadSeriesChapters(userId, seriesKey);
    expect(chapters.map((chapter) => chapter.id)).toEqual([primeiro, segundo, terceiro]);
    // So o que a linha mostra: nada de conteudo.
    expect(chapters[1]).toEqual({
      id: segundo,
      title: "O mar aberto",
      chapter: 2,
      wordCount: 5,
      progressIndex: 3,
      abandoned: false,
    });
  });

  it("arquivados e largados entram, como no cartao da serie", async () => {
    const userId = await newUser();
    const seriesKey = `serie-${randomUUID()}`;
    await addText(userId, "Lido e arquivado", {
      seriesKey,
      chapter: 1,
      progressIndex: 5,
      archivedAt: new Date(),
    });
    await addText(userId, "Largado no meio", {
      seriesKey,
      chapter: 2,
      progressIndex: 2,
      abandonedAt: new Date(),
      abandonedWords: 3,
    });
    await addText(userId, "Por ler", { seriesKey, chapter: 3 });

    const chapters = await loadSeriesChapters(userId, seriesKey);
    expect(chapters.map((chapter) => [chapter.title, chapter.abandoned])).toEqual([
      ["Lido e arquivado", false],
      ["Largado no meio", true],
      ["Por ler", false],
    ]);
  });

  it("so os capitulos do dono e da mesma serie", async () => {
    const userId = await newUser();
    const outro = await newUser();
    const seriesKey = `serie-${randomUUID()}`;
    await addText(userId, "Meu capitulo 1", { seriesKey, chapter: 1 });
    await addText(userId, "Meu capitulo 2", { seriesKey, chapter: 2 });
    await addText(userId, "Outra serie", { seriesKey: `serie-${randomUUID()}`, chapter: 1 });
    await addText(userId, "Texto solto");
    // Duas contas podem importar o mesmo livro: a chave e a mesma.
    await addText(outro, "Capitulo de outra conta", { seriesKey, chapter: 1 });

    const chapters = await loadSeriesChapters(userId, seriesKey);
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Meu capitulo 1", "Meu capitulo 2"]);
  });

  it("numero repetido: o importado por ultimo vem primeiro, como na biblioteca", async () => {
    const userId = await newUser();
    const seriesKey = `serie-${randomUUID()}`;
    await addText(userId, "Capitulo 2 antigo", { seriesKey, chapter: 2, createdAt: ago(2 * DAY) });
    await addText(userId, "Capitulo 2 novo", { seriesKey, chapter: 2, createdAt: ago(DAY) });
    await addText(userId, "Capitulo 1", { seriesKey, chapter: 1, createdAt: ago(3 * DAY) });

    const chapters = await loadSeriesChapters(userId, seriesKey);
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "Capitulo 1",
      "Capitulo 2 novo",
      "Capitulo 2 antigo",
    ]);
  });
});
