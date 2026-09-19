import { NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { tags } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { loadTags } from "@/lib/queries";
import { MAX_TAGS_PER_USER, normalizeTagName } from "@/lib/tags";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    return NextResponse.json({ tags: await loadTags(session.id) });
  } catch (error) {
    return serverError("etiquetas/list", error);
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{ name?: unknown }>(request);
    const name = normalizeTagName(body?.name);
    if (!name) return jsonError("Informe o nome da etiqueta.", 400);

    const [existing] = await db
      .select({ value: count() })
      .from(tags)
      .where(eq(tags.userId, session.id));

    if ((existing?.value ?? 0) >= MAX_TAGS_PER_USER) {
      return jsonError("Voce ja tem etiquetas demais.", 409);
    }

    // O indice unico ignora caixa e acento: criar de novo devolve a existente
    // em vez de recusar, que e o que a tela espera ao digitar um nome ja usado.
    await db.insert(tags).values({ userId: session.id, name }).onConflictDoNothing();

    return NextResponse.json({ tags: await loadTags(session.id) }, { status: 201 });
  } catch (error) {
    return serverError("etiquetas/create", error);
  }
}
