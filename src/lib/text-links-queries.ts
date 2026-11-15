import "server-only";

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { asTextFormat, parseParagraphs, type Paragraph } from "@/lib/reading";
import { ACCENTED, UNACCENTED } from "@/lib/text-filter";
import type { LibraryRow, Term } from "@/lib/text-links";

/**
 * Consultas das ligacoes entre textos (US-232). Sempre filtradas pela conta:
 * nenhum texto de outra pessoa entra como candidato.
 */

/**
 * Para cada outro texto da conta, se ele tem cada termo como comeco de
 * palavra. So saem do banco os booleanos, nunca o conteudo. Arquivados
 * entram; largados (US-79) saem da biblioteca e daqui tambem; o proprio texto
 * fica de fora.
 */
export async function libraryHits(userId: string, textId: string, terms: Term[]): Promise<LibraryRow[]> {
  if (terms.length === 0) return [];
  const folded = sql`translate(lower(${texts.content}), ${ACCENTED}, ${UNACCENTED})`;
  // Os termos sao so letras (`characteristicTerms`), mas vao como parametro.
  const columns = terms.map(
    (term) => sql<boolean>`(${folded} ~ ${`\\m${term.term}`})`
  );
  const rows = await db
    .select({
      id: texts.id,
      title: texts.title,
      updatedAt: texts.updatedAt,
      seriesKey: texts.seriesKey,
      chapter: texts.chapter,
      hits: sql<boolean[]>`array[${sql.join(columns, sql`, `)}]`,
    })
    .from(texts)
    .where(and(eq(texts.userId, userId), ne(texts.id, textId), isNull(texts.abandonedAt)));
  return rows.map((row) => ({
    ...row,
    hits: Array.isArray(row.hits) ? row.hits.map((hit) => hit === true || (hit as unknown) === "t") : [],
  }));
}

export interface CandidateContent {
  id: string;
  title: string;
  words: string[];
  paragraphs: Paragraph[];
}

/** Conteudo dos candidatos escolhidos, ainda filtrado pela conta. */
export async function loadCandidates(userId: string, ids: string[]): Promise<CandidateContent[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: texts.id, title: texts.title, content: texts.content, format: texts.format })
    .from(texts)
    .where(and(eq(texts.userId, userId), inArray(texts.id, ids)));
  return rows.map((row) => {
    const { words, paragraphs } = parseParagraphs(row.content, asTextFormat(row.format));
    return { id: row.id, title: row.title, words, paragraphs };
  });
}

/** Serie deste texto, para marcar os capitulos irmaos. */
export async function seriesOf(userId: string, textId: string): Promise<string | null> {
  const [row] = await db
    .select({ seriesKey: texts.seriesKey })
    .from(texts)
    .where(and(eq(texts.id, textId), eq(texts.userId, userId)))
    .limit(1);
  return row?.seriesKey ?? null;
}
