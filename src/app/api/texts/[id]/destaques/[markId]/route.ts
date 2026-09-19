import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { highlights } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { asNote } from "@/lib/highlights";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string; markId: string }> };

/** Filtra por dono e por texto: um id de outra conta da 404. */
function owned(markId: string, textId: string, userId: string) {
  return and(
    eq(highlights.id, markId),
    eq(highlights.textId, textId),
    eq(highlights.userId, userId)
  );
}

/**
 * Escreve ou apaga a nota do destaque.
 *
 * Nota vazia remove a nota e mantem o destaque: apagar o texto do comentario e
 * desistir do comentario, nao da marcacao.
 */
export async function PATCH(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id, markId } = await params;
    if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(markId)) {
      return jsonError("Destaque nao encontrado.", 404);
    }

    const body = await readJson<{ note?: unknown }>(request);

    const [updated] = await db
      .update(highlights)
      .set({ note: asNote(body?.note), updatedAt: new Date() })
      .where(owned(markId, id, session.id))
      .returning({ id: highlights.id, note: highlights.note });

    if (!updated) return jsonError("Destaque nao encontrado.", 404);
    return NextResponse.json({ highlight: updated });
  } catch (error) {
    return serverError("destaques/note", error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id, markId } = await params;
    if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(markId)) {
      return jsonError("Destaque nao encontrado.", 404);
    }

    const removed = await db
      .delete(highlights)
      .where(owned(markId, id, session.id))
      .returning({ id: highlights.id });

    if (removed.length === 0) return jsonError("Destaque nao encontrado.", 404);
    return NextResponse.json({ success: true });
  } catch (error) {
    return serverError("destaques/delete", error);
  }
}
