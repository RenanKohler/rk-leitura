import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { reviewAnswers, studyCards } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { todayIn } from "@/lib/goals";
import { loadSettings } from "@/lib/queries";
import { loadOwnedCard } from "@/lib/study-review-queries";
import { afterGrade, currentInterval, isReviewGrade } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Registra a nota de um cartao de estudo e agenda a proxima revisao (US-156),
 * com a mesma regra de palavras e destaques (`afterGrade`). Como o destaque,
 * o cartao nao se "forma": passados os 90 dias continua voltando, de muito em
 * muito tempo.
 *
 * Cartao de trecho ainda nao lido nao e revisado: ele so existe, para o
 * leitor, no teste de conhecimento previo (US-170).
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Cartão não encontrado.", 404);

    const body = await readJson<{ grade?: unknown }>(request);
    const grade = isReviewGrade(body?.grade) ? body.grade : null;
    if (!grade) return jsonError("Informe a resposta.", 400);

    const card = await loadOwnedCard(session.id, id);
    if (!card) return jsonError("Cartão não encontrado.", 404);
    if (!card.read) {
      return jsonError("Este cartão é de um trecho que você ainda não leu.", 409);
    }

    const today = todayIn((await loadSettings(session.id))?.timezone ?? "UTC");
    const next = afterGrade(currentInterval(card.interval), grade, today);

    await db
      .update(studyCards)
      .set({
        reviewInterval: next.interval,
        nextReviewOn: next.nextReviewOn,
        lastReviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(studyCards.id, id), eq(studyCards.userId, session.id)));

    await db.insert(reviewAnswers).values({ userId: session.id, kind: "cartao", itemId: id, grade });

    return NextResponse.json({ interval: next.interval, nextReviewOn: next.nextReviewOn });
  } catch (error) {
    return serverError("cartoes/revisao", error);
  }
}
