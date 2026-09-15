import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import {
  asInteger,
  asString,
  jsonError,
  readJson,
  requireSession,
  serverError,
} from "@/lib/api";
import { clamp, countWords } from "@/lib/reading";

export const dynamic = "force-dynamic";

const MAX_CONTENT_CHARS = 400_000;

type Params = { params: Promise<{ id: string }> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Todas as consultas filtram por userId: um id valido de outra conta da 404. */
function ownedText(id: string, userId: string) {
  return and(eq(texts.id, id), eq(texts.userId, userId));
}

export async function GET(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const [text] = await db.select().from(texts).where(ownedText(id, session.id)).limit(1);
    if (!text) return jsonError("Texto nao encontrado.", 404);

    return NextResponse.json({ text });
  } catch (error) {
    return serverError("texts/get", error);
  }
}

export async function PUT(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const body = await readJson<{ title?: unknown; sourceUrl?: unknown; content?: unknown }>(request);
    const title = asString(body?.title);
    const content = asString(body?.content);
    const sourceUrl = asString(body?.sourceUrl);

    if (!title || !content) {
      return jsonError("Titulo e conteudo sao obrigatorios.", 400);
    }
    if (content.length > MAX_CONTENT_CHARS) {
      return jsonError("O texto e grande demais.", 413);
    }

    const wordCount = countWords(content);
    const [updated] = await db
      .update(texts)
      .set({
        title: title.slice(0, 200),
        sourceUrl,
        content,
        wordCount,
        // O texto mudou: a posicao salva pode estar alem do novo fim.
        progressIndex: 0,
        updatedAt: new Date(),
      })
      .where(ownedText(id, session.id))
      .returning();

    if (!updated) return jsonError("Texto nao encontrado.", 404);
    return NextResponse.json({ text: updated });
  } catch (error) {
    return serverError("texts/update", error);
  }
}

/** Salva a posicao de leitura para retomar depois. */
export async function PATCH(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const body = await readJson<{ progressIndex?: unknown }>(request);
    const progressIndex = asInteger(body?.progressIndex);
    if (progressIndex === null) return jsonError("Posicao invalida.", 400);

    const [current] = await db
      .select({ wordCount: texts.wordCount })
      .from(texts)
      .where(ownedText(id, session.id))
      .limit(1);

    if (!current) return jsonError("Texto nao encontrado.", 404);

    const [updated] = await db
      .update(texts)
      .set({ progressIndex: clamp(progressIndex, 0, current.wordCount), updatedAt: new Date() })
      .where(ownedText(id, session.id))
      .returning({ id: texts.id, progressIndex: texts.progressIndex });

    return NextResponse.json({ text: updated });
  } catch (error) {
    return serverError("texts/progress", error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const deleted = await db
      .delete(texts)
      .where(ownedText(id, session.id))
      .returning({ id: texts.id });

    if (deleted.length === 0) return jsonError("Texto nao encontrado.", 404);
    return NextResponse.json({ success: true });
  } catch (error) {
    return serverError("texts/delete", error);
  }
}
