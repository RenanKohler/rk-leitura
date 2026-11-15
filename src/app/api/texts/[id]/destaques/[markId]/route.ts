import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { highlights } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { todayIn } from "@/lib/goals";
import { asNote, firstHighlightDue } from "@/lib/highlights";
import { loadSettings } from "@/lib/queries";

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
 * Escreve ou apaga a nota do destaque, ou tira e devolve o destaque a
 * revisao (US-223).
 *
 * Nota vazia remove a nota e mantem o destaque: apagar o texto do comentario e
 * desistir do comentario, nao da marcacao.
 *
 * `{ review: false }` tira o destaque da revisao: ele continua no texto e
 * guarda a agenda que tinha. `{ review: true }` devolve; se a data guardada
 * ja passou (ou nunca houve), ele vence no dia seguinte, e nao na hora -
 * quem pede para voltar a revisar nao pediu para revisar agora. Os dois
 * pedidos podem ser repetidos sem efeito novo, o que importa porque este
 * PATCH entra na fila offline do service worker (`public/sw.js`).
 */
export async function PATCH(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id, markId } = await params;
    if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(markId)) {
      return jsonError("Destaque não encontrado.", 404);
    }

    const body = await readJson<{ note?: unknown; review?: unknown }>(request);

    // Pedido de revisao: nao toca na nota nem em `updatedAt`, que diz quando
    // o destaque ou a nota mudaram.
    if (typeof body?.review === "boolean") {
      if (!body.review) {
        const [off] = await db
          .update(highlights)
          // Quem ja estava fora fica com a data da primeira vez.
          .set({ reviewOffAt: sql`coalesce(${highlights.reviewOffAt}, now())` })
          .where(owned(markId, id, session.id))
          .returning({ id: highlights.id });
        if (!off) return jsonError("Destaque não encontrado.", 404);
        return NextResponse.json({ highlight: { id: off.id, reviewOff: true } });
      }

      const timezone = (await loadSettings(session.id))?.timezone ?? "UTC";
      const today = todayIn(timezone);
      const tomorrow = firstHighlightDue(new Date(), timezone);
      const [back] = await db
        .update(highlights)
        .set({
          reviewOffAt: null,
          // Data futura guardada continua valendo; vencida ou ausente vira amanha.
          // So para quem estava fora: repetir o pedido nao adia quem ja voltou.
          reviewDueOn: sql`case
            when ${highlights.reviewOffAt} is not null
              and (${highlights.reviewDueOn} is null or ${highlights.reviewDueOn} <= ${today})
            then ${tomorrow}::date
            else ${highlights.reviewDueOn}
          end`,
        })
        .where(owned(markId, id, session.id))
        .returning({ id: highlights.id, reviewDueOn: highlights.reviewDueOn });
      if (!back) return jsonError("Destaque não encontrado.", 404);
      return NextResponse.json({
        highlight: { id: back.id, reviewOff: false, reviewDueOn: back.reviewDueOn },
      });
    }

    const [updated] = await db
      .update(highlights)
      .set({ note: asNote(body?.note), updatedAt: new Date() })
      .where(owned(markId, id, session.id))
      .returning({ id: highlights.id, note: highlights.note });

    if (!updated) return jsonError("Destaque não encontrado.", 404);
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
      return jsonError("Destaque não encontrado.", 404);
    }

    const removed = await db
      .delete(highlights)
      .where(owned(markId, id, session.id))
      .returning({ id: highlights.id });

    if (removed.length === 0) return jsonError("Destaque não encontrado.", 404);
    return NextResponse.json({ success: true });
  } catch (error) {
    return serverError("destaques/delete", error);
  }
}
