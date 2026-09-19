import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { highlights } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { loadHighlights } from "@/lib/queries";
import { absorb, normalizeRange } from "@/lib/highlights";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const loaded = await loadHighlights(session.id, id);
    if (!loaded) return jsonError("Texto nao encontrado.", 404);

    return NextResponse.json({ highlights: loaded.items });
  } catch (error) {
    return serverError("destaques/list", error);
  }
}

/**
 * Cria um destaque, fundindo com os que ele encosta.
 *
 * Marcar a segunda metade de uma frase ja marcada e continuar a mesma
 * marcacao: dois destaques sobrepostos nao teriam como ser pintados nem
 * tocados sem ambiguidade.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const body = await readJson<{ start?: unknown; end?: unknown }>(request);

    const loaded = await loadHighlights(session.id, id);
    if (!loaded) return jsonError("Texto nao encontrado.", 404);

    const range = normalizeRange(body?.start, body?.end, loaded.text.wordCount);
    if (!range) return jsonError("Selecione um trecho para destacar.", 400);

    const { range: merged, absorbed, note } = absorb(loaded.items, range);

    const created = await db.transaction(async (tx) => {
      if (absorbed.length > 0) {
        await tx.delete(highlights).where(inArray(highlights.id, absorbed));
      }

      const [row] = await tx
        .insert(highlights)
        .values({
          userId: session.id,
          textId: id,
          startIndex: merged.start,
          endIndex: merged.end,
          note,
        })
        .returning({ id: highlights.id });

      return row;
    });

    const after = await loadHighlights(session.id, id);
    return NextResponse.json(
      { id: created?.id, highlights: after?.items ?? [] },
      { status: 201 }
    );
  } catch (error) {
    return serverError("destaques/create", error);
  }
}

/** Remove todos os destaques do texto de uma vez. */
export async function DELETE(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const removed = await db
      .delete(highlights)
      .where(and(eq(highlights.userId, session.id), eq(highlights.textId, id)))
      .returning({ id: highlights.id });

    return NextResponse.json({ removed: removed.length });
  } catch (error) {
    return serverError("destaques/clear", error);
  }
}
