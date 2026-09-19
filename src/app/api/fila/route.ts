import { NextResponse } from "next/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { loadQueue } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Teto da fila: acima disso ela deixa de ser uma fila e vira outra biblioteca. */
const MAX_QUEUE = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    return NextResponse.json({ queue: await loadQueue(session.id) });
  } catch (error) {
    return serverError("fila/list", error);
  }
}

/** Entra no fim da fila. */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{ textId?: unknown }>(request);
    const textId = typeof body?.textId === "string" ? body.textId : "";
    if (!UUID_PATTERN.test(textId)) return jsonError("Texto nao encontrado.", 404);

    const current = await loadQueue(session.id);
    if (current.some((item) => item.id === textId)) {
      return NextResponse.json({ queue: current });
    }
    if (current.length >= MAX_QUEUE) {
      return jsonError(`A fila comporta ${MAX_QUEUE} textos.`, 409);
    }

    const last = current.at(-1)?.queuePosition ?? 0;
    const [updated] = await db
      .update(texts)
      .set({ queuePosition: last + 1 })
      // Arquivado nao entra na fila: sairia dela na hora, pelo criterio 3.
      .where(and(eq(texts.id, textId), eq(texts.userId, session.id), isNull(texts.archivedAt)))
      .returning({ id: texts.id });

    // Nao distingue "nao existe" de "esta arquivado" no status, mas a mensagem
    // sim: a primeira causa e rara, a segunda acontece o tempo todo e precisa
    // dizer o que fazer.
    if (!updated) return jsonError("Textos arquivados nao entram na fila.", 409);
    return NextResponse.json({ queue: await loadQueue(session.id) }, { status: 201 });
  } catch (error) {
    return serverError("fila/add", error);
  }
}

/**
 * Reordena a fila inteira.
 *
 * A tela manda a ordem completa em vez de "mova o item X para a posicao N":
 * arrastar produz uma ordem nova, e reconstruir posicoes uma a uma abriria
 * espaco para duas telas gravarem metades de ordens diferentes.
 */
export async function PUT(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{ ids?: unknown }>(request);
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id): id is string => typeof id === "string" && UUID_PATTERN.test(id))
      : [];

    if (ids.length === 0) return jsonError("Envie a ordem da fila.", 400);

    await db.transaction(async (tx) => {
      // Um CASE so, em vez de um UPDATE por item: a fila inteira muda de
      // posicao a cada arrasto.
      const order = sql.join(
        ids.map((id, position) => sql`when ${texts.id} = ${id} then ${position + 1}`),
        sql` `
      );

      await tx
        .update(texts)
        .set({ queuePosition: sql`case ${order} else ${texts.queuePosition} end` })
        .where(and(eq(texts.userId, session.id), inArray(texts.id, ids)));
    });

    return NextResponse.json({ queue: await loadQueue(session.id) });
  } catch (error) {
    return serverError("fila/reorder", error);
  }
}

/** Tira o texto da fila; ele continua na biblioteca. */
export async function DELETE(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const textId = new URL(request.url).searchParams.get("texto") ?? "";
    if (!UUID_PATTERN.test(textId)) return jsonError("Texto nao encontrado.", 404);

    await db
      .update(texts)
      .set({ queuePosition: null })
      .where(and(eq(texts.id, textId), eq(texts.userId, session.id)));

    return NextResponse.json({ queue: await loadQueue(session.id) });
  } catch (error) {
    return serverError("fila/remove", error);
  }
}
