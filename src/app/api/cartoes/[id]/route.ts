import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { studyCards } from "@/db/schema";
import { isUniqueViolation, jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { clozeSentence, DUPLICATE_FRONT, manualCard, normalizeGap, storedFrontKey } from "@/lib/study-card-drafts";
import { loadFrontKeys, loadOwnedCard } from "@/lib/study-card-store";
import { isCardRead } from "@/lib/study-cards";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND = "Cartão não encontrado.";

/**
 * Edita a frente e o verso de um cartao de estudo. Cartao de trecho nao lido
 * nao aparece na tela, entao tambem nao e editado aqui.
 */
export async function PATCH(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    const card = await loadOwnedCard(session.id, id);
    if (!card || !isCardRead(card, card)) return jsonError(NOT_FOUND, 404);

    const body = await readJson<{ front?: unknown; back?: unknown }>(request);
    const sides = manualCard(body?.front, body?.back);
    if ("error" in sides) return jsonError(sides.error, 400);
    const front = card.kind === "lacuna" ? normalizeGap(sides.front) : sides.front;
    if (card.kind === "lacuna" && !clozeSentence(front, sides.back)) {
      return jsonError("Mantenha uma lacuna (____) na frente.", 400);
    }

    // A frente nova nao pode repetir a de outro cartao do texto (US-197).
    const key = storedFrontKey(front);
    if (key && (await loadFrontKeys(session.id, card.textId, card.id)).has(key)) {
      return jsonError(DUPLICATE_FRONT, 409);
    }

    await db
      .update(studyCards)
      // Editado: deixa de ser "o que a IA gerou" (US-193).
      .set({ front, back: sides.back, frontKey: key, editedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(studyCards.id, card.id), eq(studyCards.userId, session.id)));
    return NextResponse.json({ card: { id: card.id, front, back: sides.back } });
  } catch (error) {
    if (isUniqueViolation(error)) return jsonError(DUPLICATE_FRONT, 409);
    return serverError("cartoes/editar", error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    const card = await loadOwnedCard(session.id, id);
    if (!card) return jsonError(NOT_FOUND, 404);
    await db
      .delete(studyCards)
      .where(and(eq(studyCards.id, card.id), eq(studyCards.userId, session.id)));
    return NextResponse.json({ deleted: card.id });
  } catch (error) {
    return serverError("cartoes/apagar", error);
  }
}
