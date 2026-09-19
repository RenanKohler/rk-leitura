import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { speedSettings } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { loadSettings } from "@/lib/queries";
import {
  measuredWpm,
  PLACEMENT_QUESTIONS,
  PLACEMENT_TEXT,
  PLACEMENT_TITLE,
  PLACEMENT_WORDS,
  plausibleDuration,
  scorePlacement,
  suggestionReason,
  suggestWpm,
} from "@/lib/placement";
import { clamp, MAX_WPM, MIN_WPM } from "@/lib/reading";

export const dynamic = "force-dynamic";

/**
 * Teste de velocidade inicial.
 *
 * O GET entrega o material sem o gabarito - a correcao acontece no POST, como
 * no questionario de compreensao: com as respostas certas na tela, o teste
 * mediria outra coisa.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const settings = await loadSettings(session.id);
    if (!settings) return jsonError("Sessao expirada. Entre novamente.", 401);

    return NextResponse.json({
      title: PLACEMENT_TITLE,
      text: PLACEMENT_TEXT,
      words: PLACEMENT_WORDS,
      questions: PLACEMENT_QUESTIONS.map(({ prompt, choices }) => ({ prompt, choices })),
    });
  } catch (error) {
    return serverError("teste/get", error);
  }
}

/** Corrige, calcula a sugestao e - se aceita - passa a valer como base. */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{
      durationMs?: unknown;
      answers?: unknown;
      accept?: unknown;
    }>(request);

    const durationMs = Math.trunc(Number(body?.durationMs));
    if (!Number.isFinite(durationMs) || !plausibleDuration(durationMs)) {
      return jsonError("A leitura foi rapida ou longa demais para medir.", 400);
    }

    const answers = Array.isArray(body?.answers) ? body.answers.map((v) => Number(v)) : null;
    if (!answers) return jsonError("Envie as respostas.", 400);

    const wpm = clamp(measuredWpm(durationMs), MIN_WPM, MAX_WPM);
    const comprehension = scorePlacement(answers);
    const suggested = suggestWpm(wpm, comprehension);
    const accept = body?.accept === true;

    await db
      .update(speedSettings)
      .set({
        placementWpm: wpm,
        placementSeenAt: new Date(),
        ...(accept ? { baseWpm: suggested } : {}),
        updatedAt: new Date(),
      })
      .where(eq(speedSettings.userId, session.id));

    return NextResponse.json({
      wpm,
      comprehension,
      suggested,
      reason: suggestionReason(comprehension),
      applied: accept,
      results: PLACEMENT_QUESTIONS.map((question, index) => ({
        prompt: question.prompt,
        choices: question.choices,
        answer: question.answer,
        given: Number.isInteger(answers[index]) ? answers[index] : null,
      })),
    });
  } catch (error) {
    return serverError("teste/post", error);
  }
}

/** Pular: o teste nao volta a ser oferecido sozinho, mas continua em Ajustes. */
export async function DELETE() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    await db
      .update(speedSettings)
      .set({ placementSeenAt: new Date(), updatedAt: new Date() })
      .where(eq(speedSettings.userId, session.id));

    return NextResponse.json({ skipped: true });
  } catch (error) {
    return serverError("teste/skip", error);
  }
}
