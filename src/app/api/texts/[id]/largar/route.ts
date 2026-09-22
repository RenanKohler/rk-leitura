import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Larga o texto no meio (US-79).
 *
 * Sai da lista principal e da fila; as sessoes ja registradas ficam, entao a
 * meta do dia e a sequencia nao mudam. As palavras que faltavam ficam
 * guardadas para o tempo economizado do resumo semanal (US-81).
 */
export async function POST(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const owned = and(eq(texts.id, id), eq(texts.userId, session.id));
    const [current] = await db
      .select({ progressIndex: texts.progressIndex, wordCount: texts.wordCount })
      .from(texts)
      .where(owned)
      .limit(1);
    if (!current) return jsonError("Texto nao encontrado.", 404);
    if (current.wordCount > 0 && current.progressIndex >= current.wordCount) {
      return jsonError("Texto ja concluido nao pode ser largado.", 409);
    }

    await db
      .update(texts)
      .set({
        abandonedAt: new Date(),
        abandonedWords: sql`greatest(${texts.wordCount} - ${texts.progressIndex}, 0)`,
        queuePosition: null,
        updatedAt: new Date(),
      })
      .where(owned);

    return NextResponse.json({ abandoned: true });
  } catch (error) {
    return serverError("texts/largar", error);
  }
}

/** Retoma um texto largado: volta a lista principal na posicao em que parou. */
export async function DELETE(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const [updated] = await db
      .update(texts)
      .set({ abandonedAt: null, abandonedWords: null, updatedAt: new Date() })
      .where(and(eq(texts.id, id), eq(texts.userId, session.id)))
      .returning({ id: texts.id });
    if (!updated) return jsonError("Texto nao encontrado.", 404);

    return NextResponse.json({ abandoned: false });
  } catch (error) {
    return serverError("texts/retomar", error);
  }
}
