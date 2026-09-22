import { NextResponse } from "next/server";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCH = 200;

/**
 * Falencia da fila (US-82): larga de uma vez os textos escolhidos.
 *
 * Devolve a posicao que cada um tinha na fila: e o que o "Desfazer" manda de
 * volta para `/api/fila/retomar`.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{ ids?: unknown }>(request);
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id): id is string => typeof id === "string" && UUID_PATTERN.test(id))
      : [];
    if (ids.length === 0 || ids.length > MAX_BATCH) return jsonError("Escolha os textos.", 400);

    const restored = await db.transaction(async (tx) => {
      const before = await tx
        .select({ id: texts.id, queuePosition: texts.queuePosition })
        .from(texts)
        .where(
          and(eq(texts.userId, session.id), inArray(texts.id, ids), isNotNull(texts.queuePosition))
        );

      if (before.length > 0) {
        await tx
          .update(texts)
          .set({
            abandonedAt: new Date(),
            abandonedWords: sql`greatest(${texts.wordCount} - ${texts.progressIndex}, 0)`,
            queuePosition: null,
            updatedAt: new Date(),
          })
          .where(and(eq(texts.userId, session.id), inArray(texts.id, before.map((row) => row.id))));
      }
      return before;
    });

    return NextResponse.json({ abandoned: restored.length, restore: restored });
  } catch (error) {
    return serverError("fila/largar", error);
  }
}
