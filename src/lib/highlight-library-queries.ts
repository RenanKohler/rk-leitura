import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { highlights, tags, texts, textTags } from "@/db/schema";
import {
  HIGHLIGHT_EXPORT_LIMIT,
  HIGHLIGHT_LIBRARY_LIMIT,
  withExcerpts,
  type HighlightRow,
} from "@/lib/highlight-library";
import { tagKey } from "@/lib/tags";
import type { HighlightExport, HighlightLibrary } from "@/lib/types";

/**
 * Consultas de "Destaques e notas" (US-224): os destaques da conta inteira,
 * de todos os textos, arquivados e largados inclusive. As regras puras estao
 * em `highlight-library.ts`.
 *
 * O trecho nao esta no banco; sai do conteudo do texto. Por isso sao duas
 * consultas, e nao uma com juncao: a juncao repetiria o conteudo inteiro do
 * texto em cada destaque dele.
 */

/**
 * Primeira consulta: os destaques mais recentes da conta, ate `limit`, e
 * quantos ela tem ao todo.
 */
async function recentHighlights(
  userId: string,
  limit: number
): Promise<{ rows: HighlightRow[]; total: number }> {
  const rows = await db
    .select({
      id: highlights.id,
      textId: highlights.textId,
      start: highlights.startIndex,
      end: highlights.endIndex,
      note: highlights.note,
      reviewOffAt: highlights.reviewOffAt,
      createdAt: highlights.createdAt,
      // A janela conta antes do limite: o total vem junto, sem outra consulta,
      // e e ele que deixa a tela dizer quantos ficaram de fora.
      total: sql<number>`(count(*) over())::int`,
    })
    .from(highlights)
    .where(eq(highlights.userId, userId))
    // O id desempata destaques do mesmo instante, para o corte do limite cair
    // sempre no mesmo lugar.
    .orderBy(desc(highlights.createdAt), desc(highlights.id))
    .limit(limit);

  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((row) => ({
      id: row.id,
      textId: row.textId,
      start: row.start,
      end: row.end,
      note: row.note,
      // Tirado da revisao pelo leitor (US-223).
      reviewOff: row.reviewOffAt !== null,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

/** Segunda consulta: os textos desses destaques, com o conteudo de onde sai o trecho. */
async function textsOf(userId: string, textIds: string[]) {
  if (textIds.length === 0) return [];

  return db
    .select({
      id: texts.id,
      title: texts.title,
      content: texts.content,
      format: texts.format,
      author: texts.author,
      sourceUrl: texts.sourceUrl,
      createdAt: texts.createdAt,
    })
    .from(texts)
    .where(and(eq(texts.userId, userId), inArray(texts.id, textIds)));
}

function distinctTextIds(rows: HighlightRow[]): string[] {
  return [...new Set(rows.map((row) => row.textId))];
}

/**
 * O que a tela "Destaques e notas" mostra: os destaques mais recentes, ate o
 * limite, com o trecho ja reconstruido, e os textos deles.
 *
 * O conteudo dos textos fica no servidor; para a tela vao so o trecho de
 * cada destaque e o titulo de cada texto.
 */
export async function loadHighlightLibrary(userId: string): Promise<HighlightLibrary> {
  const { rows, total } = await recentHighlights(userId, HIGHLIGHT_LIBRARY_LIMIT);
  const sources = await textsOf(userId, distinctTextIds(rows));

  return {
    items: withExcerpts(rows, sources),
    texts: sources.map((source) => ({ id: source.id, title: source.title })),
    total,
  };
}

/** Nomes das etiquetas de cada texto, em ordem alfabetica, como `tagsByText` faz para a biblioteca. */
async function tagNames(userId: string, textIds: string[]): Promise<Map<string, string[]>> {
  if (textIds.length === 0) return new Map();

  const rows = await db
    .select({ textId: textTags.textId, name: tags.name })
    .from(textTags)
    .innerJoin(tags, eq(tags.id, textTags.tagId))
    .where(and(eq(tags.userId, userId), inArray(textTags.textId, textIds)));

  const byText = new Map<string, string[]>();
  for (const row of rows) {
    const list = byText.get(row.textId) ?? [];
    list.push(row.name);
    byText.set(row.textId, list);
  }
  for (const list of byText.values()) {
    list.sort((a, b) => tagKey(a).localeCompare(tagKey(b)));
  }
  return byText;
}

/**
 * O que a exportacao de tudo leva: os destaques da conta com o trecho, e de
 * cada texto o que o arquivo escreve (autor, origem, etiquetas e data).
 *
 * O limite da tela nao vale aqui. Fica so o teto de seguranca
 * (`HIGHLIGHT_EXPORT_LIMIT`), e `total` deixa o arquivo avisar se ele cortar.
 * Os trechos passam pelo mesmo `withExcerpts` da tela, entao o arquivo traz
 * o que o leitor acabou de ver.
 */
export async function loadHighlightExport(userId: string): Promise<HighlightExport> {
  const { rows, total } = await recentHighlights(userId, HIGHLIGHT_EXPORT_LIMIT);
  const textIds = distinctTextIds(rows);
  const [sources, labels] = await Promise.all([textsOf(userId, textIds), tagNames(userId, textIds)]);

  return {
    items: withExcerpts(rows, sources),
    texts: sources.map((source) => ({
      id: source.id,
      title: source.title,
      author: source.author,
      sourceUrl: source.sourceUrl,
      tags: labels.get(source.id) ?? [],
      createdAt: source.createdAt.toISOString(),
    })),
    total,
  };
}
