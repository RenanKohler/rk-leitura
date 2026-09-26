import { NextResponse } from "next/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { requireSession, serverError } from "@/lib/api";
import { countCitations, MIN_CITATIONS } from "@/lib/citations";

export const dynamic = "force-dynamic";

/** Textos lidos por chamada: o conteudo vem inteiro, e sao ate 400 mil caracteres cada. */
const PAGE = 40;

/**
 * Textos da biblioteca que parecem artigo cientifico e ainda tem as
 * referencias no corpo. Paginado: a tela chama ate `next` ser nulo, e uma
 * biblioteca grande nao estoura o tempo de uma funcao.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const offset = Math.max(0, Math.trunc(Number(new URL(request.url).searchParams.get("de") ?? 0)) || 0);
    const rows = await db
      .select({ id: texts.id, title: texts.title, content: texts.content })
      .from(texts)
      .where(and(eq(texts.userId, session.id), isNull(texts.originalContent)))
      .orderBy(asc(texts.createdAt), asc(texts.id))
      .limit(PAGE)
      .offset(offset);

    const candidates = rows
      .map((row) => ({ id: row.id, title: row.title, citations: countCitations(row.content) }))
      .filter((row) => row.citations >= MIN_CITATIONS);

    return NextResponse.json({ candidates, next: rows.length === PAGE ? offset + PAGE : null });
  } catch (error) {
    return serverError("reprocessar", error);
  }
}
