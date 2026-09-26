import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bookmarks } from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string; bookmarkId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id, bookmarkId } = await params;
    if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(bookmarkId)) {
      return jsonError("Marcador nao encontrado.", 404);
    }

    const removed = await db
      .delete(bookmarks)
      .where(
        and(eq(bookmarks.id, bookmarkId), eq(bookmarks.textId, id), eq(bookmarks.userId, session.id))
      )
      .returning({ id: bookmarks.id });

    if (removed.length === 0) return jsonError("Marcador nao encontrado.", 404);
    return NextResponse.json({ success: true });
  } catch (error) {
    return serverError("marcadores/delete", error);
  }
}
