import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { reviewAnswers, savedWords } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { todayIn } from "@/lib/goals";
import { loadReview, loadSettings } from "@/lib/queries";
import { afterGrade, currentInterval, gradeFrom } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sessao de revisao do dia (US-64). */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    return NextResponse.json(await loadReview(session.id));
  } catch (error) {
    return serverError("palavras/revisao", error);
  }
}

/**
 * Registra a resposta e agenda a proxima revisao (PROD-7).
 *
 * Aceita `grade` ("errei", "dificil", "bom", "facil") e, por compatibilidade,
 * o `remembered` antigo: lembrei vale "bom", nao lembrei vale "errei".
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{ id?: unknown; remembered?: unknown; grade?: unknown }>(request);
    const id = typeof body?.id === "string" && UUID_PATTERN.test(body.id) ? body.id : null;
    const grade = gradeFrom(body);
    if (!id || !grade) {
      return jsonError("Informe a palavra e a resposta.", 400);
    }

    const owned = and(eq(savedWords.id, id), eq(savedWords.userId, session.id));
    const [current] = await db
      .select({ step: savedWords.reviewStep, interval: savedWords.reviewInterval })
      .from(savedWords)
      .where(owned)
      .limit(1);
    if (!current) return jsonError("Palavra nao encontrada.", 404);

    const today = todayIn((await loadSettings(session.id))?.timezone ?? "UTC");
    const next = afterGrade(currentInterval(current.interval, current.step), grade, today);
    // A etapa antiga segue contando acertos seguidos, para quem ainda a le.
    const step = grade === "errei" ? 0 : current.step + 1;

    await db
      .update(savedWords)
      .set({
        reviewStep: step,
        reviewInterval: next.interval,
        nextReviewOn: next.nextReviewOn,
        // Formada aos 90 dias: sai da revisao e fica na lista como aprendida.
        ...(next.graduated ? { learnedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(owned);

    await db
      .insert(reviewAnswers)
      .values({ userId: session.id, kind: "palavra", itemId: id, grade });

    return NextResponse.json({ ...next, step });
  } catch (error) {
    return serverError("palavras/revisao/responder", error);
  }
}
