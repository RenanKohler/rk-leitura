import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tags } from "@/db/schema";
import { isUniqueViolation, jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { loadTags } from "@/lib/queries";
import { normalizeTagName } from "@/lib/tags";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/** Renomear vale para todos os textos: o vinculo e com a etiqueta, nao o nome. */
export async function PATCH(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Etiqueta nao encontrada.", 404);

    const body = await readJson<{ name?: unknown }>(request);
    const name = normalizeTagName(body?.name);
    if (!name) return jsonError("Informe o nome da etiqueta.", 400);

    const [updated] = await db
      .update(tags)
      .set({ name })
      .where(and(eq(tags.id, id), eq(tags.userId, session.id)))
      .returning({ id: tags.id });

    if (!updated) return jsonError("Etiqueta nao encontrada.", 404);
    return NextResponse.json({ tags: await loadTags(session.id) });
  } catch (error) {
    // Renomear para um nome ja usado bate no indice unico.
    if (isUniqueViolation(error)) {
      return jsonError("Ja existe uma etiqueta com esse nome.", 409);
    }
    return serverError("etiquetas/rename", error);
  }
}

/** Excluir desfaz o vinculo em todos os textos, pela cascata. */
export async function DELETE(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Etiqueta nao encontrada.", 404);

    const removed = await db
      .delete(tags)
      .where(and(eq(tags.id, id), eq(tags.userId, session.id)))
      .returning({ id: tags.id });

    if (removed.length === 0) return jsonError("Etiqueta nao encontrada.", 404);
    return NextResponse.json({ tags: await loadTags(session.id) });
  } catch (error) {
    return serverError("etiquetas/delete", error);
  }
}
