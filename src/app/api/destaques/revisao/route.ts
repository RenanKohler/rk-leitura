import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { highlights, reviewAnswers } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { todayIn } from "@/lib/goals";
import { loadSettings } from "@/lib/queries";
import { loadHighlightReview } from "@/lib/learning-queries";
import { afterGrade, currentInterval, gradeFrom } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Destaques vencidos hoje (PROD-4). */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    return NextResponse.json(await loadHighlightReview(session.id));
  } catch (error) {
    return serverError("destaques/revisao", error);
  }
}

/**
 * Registra a resposta a um destaque e agenda a proxima revisao, com a mesma
 * regra das palavras (`afterGrade`). Destaque nao se "forma": passados os 90
 * dias ele continua voltando, so que de muito em muito tempo - um trecho
 * marcado nao e vocabulario a decorar e sair da lista.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{ id?: unknown; grade?: unknown; remembered?: unknown }>(request);
    const id = typeof body?.id === "string" && UUID_PATTERN.test(body.id) ? body.id : null;
    const grade = gradeFrom(body);
    if (!id || !grade) return jsonError("Informe o destaque e a resposta.", 400);

    const owned = and(eq(highlights.id, id), eq(highlights.userId, session.id));
    const [current] = await db
      .select({ interval: highlights.reviewInterval })
      .from(highlights)
      .where(owned)
      .limit(1);
    if (!current) return jsonError("Destaque nao encontrado.", 404);

    const today = todayIn((await loadSettings(session.id))?.timezone ?? "UTC");
    const next = afterGrade(currentInterval(current.interval), grade, today);

    // `updatedAt` fica como esta: ele diz quando o destaque ou a nota
    // mudaram, e revisar nao muda nenhum dos dois.
    await db
      .update(highlights)
      .set({
        reviewInterval: next.interval,
        reviewDueOn: next.nextReviewOn,
        lastReviewedAt: new Date(),
      })
      .where(owned);

    await db
      .insert(reviewAnswers)
      .values({ userId: session.id, kind: "destaque", itemId: id, grade });

    return NextResponse.json({ interval: next.interval, nextReviewOn: next.nextReviewOn });
  } catch (error) {
    return serverError("destaques/revisao/responder", error);
  }
}
