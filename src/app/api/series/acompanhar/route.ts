import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { seriesFollows, texts } from "@/db/schema";
import { asString, jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { MAX_FOLLOWED_SERIES } from "@/lib/follow";

export const dynamic = "force-dynamic";

/**
 * Passa a acompanhar uma serie (US-70).
 *
 * Acompanhar de novo uma serie pausada a reativa: e o jeito de tentar outra
 * vez depois que a origem voltou.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{ seriesKey?: unknown }>(request);
    const seriesKey = asString(body?.seriesKey);
    if (!seriesKey || seriesKey.length > 300) return jsonError("Informe a serie.", 400);

    const [chapter] = await db
      .select({ id: texts.id })
      .from(texts)
      .where(and(eq(texts.userId, session.id), eq(texts.seriesKey, seriesKey)))
      .limit(1);
    if (!chapter) return jsonError("Serie nao encontrada.", 404);

    const [existing] = await db
      .select({ id: seriesFollows.id })
      .from(seriesFollows)
      .where(and(eq(seriesFollows.userId, session.id), eq(seriesFollows.seriesKey, seriesKey)))
      .limit(1);

    if (existing) {
      await db
        .update(seriesFollows)
        .set({ pausedAt: null, failures: 0, lastCheckedAt: null })
        .where(eq(seriesFollows.id, existing.id));
      return NextResponse.json({ following: true, paused: false });
    }

    const [total] = await db
      .select({ value: count() })
      .from(seriesFollows)
      .where(eq(seriesFollows.userId, session.id));
    if ((total?.value ?? 0) >= MAX_FOLLOWED_SERIES) {
      return jsonError(
        `Voce ja acompanha ${MAX_FOLLOWED_SERIES} series. Deixe de acompanhar uma para seguir outra.`,
        409
      );
    }

    await db.insert(seriesFollows).values({ userId: session.id, seriesKey }).onConflictDoNothing();
    return NextResponse.json({ following: true, paused: false }, { status: 201 });
  } catch (error) {
    return serverError("series/acompanhar", error);
  }
}

/** Deixa de acompanhar: `?serie=`. */
export async function DELETE(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const seriesKey = new URL(request.url).searchParams.get("serie");
    if (!seriesKey || seriesKey.length > 300) return jsonError("Informe a serie.", 400);

    await db
      .delete(seriesFollows)
      .where(and(eq(seriesFollows.userId, session.id), eq(seriesFollows.seriesKey, seriesKey)));
    return NextResponse.json({ following: false });
  } catch (error) {
    return serverError("series/deixar", error);
  }
}
