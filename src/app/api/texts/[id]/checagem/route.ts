import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Registra que a checagem de compreensao da sessao foi oferecida (US-218).
 *
 * Fica no servidor, como o marco de "isso ainda vale?": a oferta feita num
 * aparelho nao se repete no outro no mesmo dia. Quem compara com "hoje" e o
 * leitor, no fuso do aparelho.
 */
export async function POST(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);

    const [updated] = await db
      .update(texts)
      .set({ sessionCheckOfferedAt: new Date() })
      .where(and(eq(texts.id, id), eq(texts.userId, session.id)))
      .returning({ sessionCheckOfferedAt: texts.sessionCheckOfferedAt });
    if (!updated) return jsonError("Texto não encontrado.", 404);

    return NextResponse.json(updated);
  } catch (error) {
    return serverError("texts/checagem", error);
  }
}
