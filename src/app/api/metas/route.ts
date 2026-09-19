import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { readingGoals } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { loadGoalStatus, loadSettings } from "@/lib/queries";
import { asGoalKind, GOAL_LIMITS, todayIn } from "@/lib/goals";
import { clamp } from "@/lib/reading";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    return NextResponse.json({ goal: await loadGoalStatus(session.id) });
  } catch (error) {
    return serverError("metas/get", error);
  }
}

/**
 * Define a meta a partir de hoje.
 *
 * Grava uma linha nova por dia de vigencia, em vez de atualizar a existente:
 * e o historico que permite avaliar cada dia passado pela meta que valia nele.
 * Trocar a meta duas vezes no mesmo dia substitui a do dia, e nao acumula.
 */
export async function PUT(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{ kind?: unknown; target?: unknown }>(request);
    const kind = asGoalKind(body?.kind);
    const raw = Math.trunc(Number(body?.target));

    if (!Number.isFinite(raw)) return jsonError("Informe um valor para a meta.", 400);

    const { min, max } = GOAL_LIMITS[kind];
    const target = clamp(raw, min, max);

    const settings = await loadSettings(session.id);
    if (!settings) return jsonError("Sessao expirada. Entre novamente.", 401);

    const startsOn = todayIn(settings.timezone);

    await db
      .insert(readingGoals)
      .values({ userId: session.id, kind, target, startsOn })
      .onConflictDoUpdate({
        target: [readingGoals.userId, readingGoals.startsOn],
        set: { kind, target },
      });

    return NextResponse.json({ goal: await loadGoalStatus(session.id) });
  } catch (error) {
    return serverError("metas/put", error);
  }
}

/** Remove a meta que comeca hoje, voltando a valer a anterior. */
export async function DELETE() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const settings = await loadSettings(session.id);
    if (!settings) return jsonError("Sessao expirada. Entre novamente.", 401);

    await db
      .delete(readingGoals)
      .where(
        and(
          eq(readingGoals.userId, session.id),
          eq(readingGoals.startsOn, todayIn(settings.timezone))
        )
      );

    return NextResponse.json({ goal: await loadGoalStatus(session.id) });
  } catch (error) {
    return serverError("metas/delete", error);
  }
}
