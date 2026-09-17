import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { readingSessions, texts } from "@/db/schema";
import {
  asInteger,
  asString,
  jsonError,
  readJson,
  readPageParams,
  requireSession,
  serverError,
} from "@/lib/api";
import { loadSessions } from "@/lib/queries";
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
      })
      .returning();

    return NextResponse.json({ session: created }, { status: 201 });
  } catch (error) {
    return serverError("sessions/create", error);
  }
}
