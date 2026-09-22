import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { CHECKPOINTS } from "@/lib/pacing";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Registra "continuar" num marco de "isso ainda vale?" (US-80).
 *
 * Fica no servidor, e nao no aparelho, para a pergunta nao se repetir quando
 * a leitura continua em outro. Nunca recua: o maior marco respondido vale.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const body = await readJson<{ marker?: unknown }>(request);
    const marker = Number(body?.marker);
    if (!(CHECKPOINTS as readonly number[]).includes(marker)) {
      return jsonError("Marco invalido.", 400);
    }

    const [updated] = await db
      .update(texts)
      .set({ checkpointAnswered: sql`greatest(${texts.checkpointAnswered}, ${marker})` })
      .where(and(eq(texts.id, id), eq(texts.userId, session.id)))
      .returning({ checkpointAnswered: texts.checkpointAnswered });
    if (!updated) return jsonError("Texto nao encontrado.", 404);

    return NextResponse.json(updated);
  } catch (error) {
    return serverError("texts/marco", error);
  }
}
