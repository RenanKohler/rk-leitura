import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { readingSessions, speedSettings, texts, trainingDays } from "@/db/schema";
import {
  asInteger,
  asString,
  jsonError,
  readJson,
  readPageParams,
  requireSession,
  serverError,
} from "@/lib/api";
import { activeProgram, loadSessions, loadSettings, loadTraining } from "@/lib/queries";
import { todayIn } from "@/lib/goals";
import { qualifies, type ProgramStatus } from "@/lib/training";
import { clamp, MAX_WPM } from "@/lib/reading";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const params = readPageParams(request);
    const { items, ...page } = await loadSessions(session.id, params.page, params.limit);
    return NextResponse.json({ sessions: items, ...page });
  } catch (error) {
    return serverError("sessions/list", error);
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{
      textId?: unknown;
      wpm?: unknown;
      wordsRead?: unknown;
      durationMs?: unknown;
      completed?: unknown;
      narrated?: unknown;
    }>(request);

    const textId = asString(body?.textId);
    const wordsRead = asInteger(body?.wordsRead);
    const durationMs = asInteger(body?.durationMs);

    if (!textId || wordsRead === null || durationMs === null) {
      return jsonError("Dados da sessao incompletos.", 400);
    }
    if (wordsRead <= 0 || durationMs <= 0) {
      return jsonError("Sessao sem leitura registrada.", 400);
    }

    // Sem esta checagem qualquer usuario grava sessoes no texto de outra conta
    // (e a chave estrangeira responderia com erro 500 para ids inexistentes).
    const [text] = await db
      .select({ id: texts.id, wordCount: texts.wordCount })
      .from(texts)
      .where(and(eq(texts.id, textId), eq(texts.userId, session.id)))
      .limit(1);

    if (!text) return jsonError("Texto nao encontrado.", 404);

    // WPM recalculado no servidor a partir de palavras e duracao.
    const computedWpm = Math.round(wordsRead / (durationMs / 60_000));

    const [created] = await db
      .insert(readingSessions)
      .values({
        userId: session.id,
        textId: text.id,
        wpm: clamp(computedWpm, 0, MAX_WPM),
        wordsRead: clamp(wordsRead, 0, text.wordCount),
        durationMs,
        completed: body?.completed === true || body?.completed === 1,
        narrated: body?.narrated === true,
      })
      .returning();

    // Uma sessao no alvo cumpre o dia do programa. Fica aqui e nao na tela
    // porque e o servidor que conhece o alvo e ja recalculou o ppm.
    const training = created ? await recordTrainingDay(session.id, created) : null;

    return NextResponse.json({ session: created, training }, { status: 201 });
  } catch (error) {
    return serverError("sessions/create", error);
  }
}

/**
 * Marca o dia do programa quando a sessao alcanca o alvo.
 *
 * Um dia de calendario, um dia de treino: sem isso, tres leituras rapidas em
 * uma tarde varreriam metade do programa. Falhar aqui nao pode derrubar o
 * registro da sessao, que ja aconteceu.
 */
async function recordTrainingDay(
  userId: string,
  created: { id: string; wpm: number; wordsRead: number; narrated: boolean }
): Promise<ProgramStatus | null> {
  try {
    const status = await loadTraining(userId);
    if (!status || status.finished || status.doneToday) return status;
    // A narracao nao cumpre o dia: o ritmo ali e o da voz do aparelho, nao o
    // do olho de quem treina.
    if (created.narrated) return status;
    if (!qualifies(created, status.targetWpm)) return status;

    const program = await activeProgram(userId);
    if (!program) return null;

    const settings = await loadSettings(userId);
    const today = todayIn(settings?.timezone ?? "UTC");

    await db
      .insert(trainingDays)
      .values({
        programId: program.id,
        day: status.currentDay,
        targetWpm: status.targetWpm,
        sessionId: created.id,
        wpm: created.wpm,
        onDay: today,
      })
      // Duas sessoes gravadas ao mesmo tempo: a segunda nao duplica o dia.
      .onConflictDoNothing();

    const after = await loadTraining(userId);

    // O alvo novo vira a velocidade do leitor: e o programa que conduz o
    // ritmo enquanto dura, e por isso abandonar devolve a velocidade antiga.
    if (after && !after.finished) {
      await db
        .update(speedSettings)
        .set({ baseWpm: after.targetWpm, updatedAt: new Date() })
        .where(eq(speedSettings.userId, userId));
    }

    return after;
  } catch (error) {
    console.error("[sessions/treino]", error);
    return null;
  }
}
