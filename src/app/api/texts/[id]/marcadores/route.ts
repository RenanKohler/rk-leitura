import { NextResponse } from "next/server";
import { db } from "@/db";
import { bookmarks } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { loadBookmarks } from "@/lib/bookmarks";
import { MAX_BOOKMARK_LABEL, MAX_BOOKMARKS } from "@/lib/navigation";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const loaded = await loadBookmarks(session.id, id);
    if (!loaded) return jsonError("Texto nao encontrado.", 404);

    return NextResponse.json({ bookmarks: loaded.items });
  } catch (error) {
    return serverError("marcadores/list", error);
  }
}

/** Cria um marcador na posicao pedida (US-92). */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const body = await readJson<{ position?: unknown; label?: unknown }>(request);
    const loaded = await loadBookmarks(session.id, id);
    if (!loaded) return jsonError("Texto nao encontrado.", 404);

    const position = Math.trunc(Number(body?.position));
    if (!Number.isFinite(position) || position < 0 || position >= loaded.wordCount) {
      return jsonError("Posicao fora do texto.", 400);
    }
    if (loaded.items.length >= MAX_BOOKMARKS) {
      return jsonError(`Limite de ${MAX_BOOKMARKS} marcadores por texto.`, 400);
    }

    const label = typeof body?.label === "string" ? body.label.trim().slice(0, MAX_BOOKMARK_LABEL) : "";
    if (!label) return jsonError("Informe o nome do marcador.", 400);

    await db.insert(bookmarks).values({ userId: session.id, textId: id, position, label });

    const after = await loadBookmarks(session.id, id);
    return NextResponse.json({ bookmarks: after?.items ?? [] }, { status: 201 });
  } catch (error) {
    return serverError("marcadores/create", error);
  }
}
