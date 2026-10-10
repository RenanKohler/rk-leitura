import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { studyCards } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { loadOwnedCard } from "@/lib/study-card-store";
import { isCardRead, isPretestAnswer } from "@/lib/study-cards";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Resposta do teste de conhecimento previo (US-170): "sabia" ou "nao_sabia".
 * Fica fora da revisao espacada: nao mexe na data nem no intervalo. So vale
 * para cartao de trecho ainda nao lido.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    const card = await loadOwnedCard(session.id, id);
    if (!card || isCardRead(card, card)) return jsonError("Cartão não encontrado.", 404);

    const body = await readJson<{ answer?: unknown }>(request);
    if (!isPretestAnswer(body?.answer)) return jsonError("Resposta inválida.", 400);

    await db
      .update(studyCards)
      .set({ pretest: body.answer, pretestedAt: new Date() })
      .where(and(eq(studyCards.id, card.id), eq(studyCards.userId, session.id)));
    return NextResponse.json({ id: card.id, answer: body.answer });
  } catch (error) {
    return serverError("cartoes/previo", error);
  }
}
