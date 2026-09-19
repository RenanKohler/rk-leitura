import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Arquiva (POST) e desarquiva (DELETE) um texto.
 *
 * Rota separada do PATCH de progresso de proposito: sao duas intencoes
 * diferentes sobre a mesma linha, e juntar as duas faria o cliente precisar
 * saber que "salvar onde parei" pode mudar em que aba o texto aparece.
 */
export async function POST(_request: Request, { params }: Params) {
  return setArchived(params, new Date());
}

export async function DELETE(_request: Request, { params }: Params) {
  return setArchived(params, null);
}

async function setArchived(params: Params["params"], archivedAt: Date | null) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const [updated] = await db
      .update(texts)
      // Arquivar tira da fila (US-56, criterio 3); desarquivar nao devolve,
      // porque a posicao anterior nao existe mais.
      .set({ archivedAt, updatedAt: new Date(), ...(archivedAt ? { queuePosition: null } : {}) })
      .where(and(eq(texts.id, id), eq(texts.userId, session.id)))
      .returning({ id: texts.id, archivedAt: texts.archivedAt });

    if (!updated) return jsonError("Texto nao encontrado.", 404);
    return NextResponse.json({ text: updated });
  } catch (error) {
    return serverError("texts/arquivo", error);
  }
}
