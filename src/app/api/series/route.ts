import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Desfaz o vinculo de serie.
 *
 * `?texto=` solta um capitulo; `?serie=` desfaz o grupo inteiro. A deteccao e
 * heuristica e erra: sem uma forma de desfazer, um agrupamento errado ficaria
 * para sempre.
 */
export async function DELETE(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const params = new URL(request.url).searchParams;
    const textId = params.get("texto");
    const key = params.get("serie");

    const target = textId
      ? UUID_PATTERN.test(textId)
        ? eq(texts.id, textId)
        : null
      : key && key.length <= 300
        ? eq(texts.seriesKey, key)
        : null;

    if (!target) return jsonError("Informe o texto ou a serie.", 400);

    const changed = await db
      .update(texts)
      .set({ seriesKey: null, chapter: null })
      .where(and(eq(texts.userId, session.id), target))
      .returning({ id: texts.id });

    return NextResponse.json({ desvinculados: changed.length });
  } catch (error) {
    return serverError("series/unlink", error);
  }
}
