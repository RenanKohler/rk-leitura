import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { savedWords } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { todayIn } from "@/lib/goals";
import { loadReview, loadSettings } from "@/lib/queries";
import { afterAnswer } from "@/lib/vocabulary";

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

/** Registra "lembrei" ou "nao lembrei" e agenda a proxima revisao. */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{ id?: unknown; remembered?: unknown }>(request);
    const id = typeof body?.id === "string" && UUID_PATTERN.test(body.id) ? body.id : null;
    if (!id || typeof body?.remembered !== "boolean") {
      return jsonError("Informe a palavra e a resposta.", 400);
    }

    const owned = and(eq(savedWords.id, id), eq(savedWords.userId, session.id));
    const [current] = await db
      .select({ step: savedWords.reviewStep })
      .from(savedWords)
      .where(owned)
      .limit(1);
    if (!current) return jsonError("Palavra nao encontrada.", 404);

    const today = todayIn((await loadSettings(session.id))?.timezone ?? "UTC");
    const next = afterAnswer(current.step, body.remembered, today);

    await db
      .update(savedWords)
      .set({ reviewStep: next.step, nextReviewOn: next.nextReviewOn, updatedAt: new Date() })
      .where(owned);

    return NextResponse.json(next);
  } catch (error) {
    return serverError("palavras/revisao/responder", error);
  }
}
