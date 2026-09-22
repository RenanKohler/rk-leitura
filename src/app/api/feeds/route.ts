import { NextResponse } from "next/server";
import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { feeds } from "@/db/schema";
import { asString, isUniqueViolation, jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { newestDate, parseFeed } from "@/lib/feed";
import { MAX_FEEDS, PAUSED_MESSAGE } from "@/lib/follow";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { fetchPublicFeed, SafeFetchError } from "@/lib/safe-fetch";
import { normalizeSourceUrl } from "@/lib/source-url";
import type { FeedSummary } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function list(userId: string): Promise<FeedSummary[]> {
  const rows = await db
    .select({ id: feeds.id, url: feeds.url, title: feeds.title, pausedAt: feeds.pausedAt })
    .from(feeds)
    .where(eq(feeds.userId, userId))
    .orderBy(asc(feeds.createdAt));
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    title: row.title,
    status: row.pausedAt ? PAUSED_MESSAGE : null,
  }));
}

/** Feeds assinados (US-71). */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    return NextResponse.json({ feeds: await list(session.id) });
  } catch (error) {
    return serverError("feeds/list", error);
  }
}

/**
 * Assina um feed.
 *
 * O endereco e lido na hora: e assim que um endereco que nao e feed e
 * recusado antes de ser salvo, e que o nome do feed vem do proprio feed.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  // Busca uma URL arbitraria, como a importacao: mesmo limite.
  const limit = await rateLimit(`import:${clientIp(request)}`, 20, 10 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas importacoes seguidas. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const body = await readJson<{ url?: unknown }>(request);
    const raw = asString(body?.url);
    if (!raw) return jsonError("Informe o endereco do feed.", 400);

    const [total] = await db
      .select({ value: count() })
      .from(feeds)
      .where(eq(feeds.userId, session.id));
    if ((total?.value ?? 0) >= MAX_FEEDS) {
      return jsonError(`Voce ja assina ${MAX_FEEDS} feeds. Remova um para assinar outro.`, 409);
    }

    let parsed;
    let finalUrl: string;
    try {
      const fetched = await fetchPublicFeed(normalizeSourceUrl(raw));
      finalUrl = fetched.finalUrl;
      parsed = parseFeed(fetched.html, fetched.finalUrl);
    } catch (error) {
      if (error instanceof SafeFetchError) return jsonError(error.message, 400);
      if (error instanceof Error && error.name === "TimeoutError") {
        return jsonError("O endereco demorou demais para responder.", 504);
      }
      throw error;
    }
    if (!parsed) return jsonError("Esse endereco nao e um feed RSS ou Atom.", 422);

    try {
      await db.insert(feeds).values({
        userId: session.id,
        url: finalUrl,
        title: parsed.title.slice(0, 120),
        // Parte do mais novo de agora: so o que for publicado depois entra.
        seenUntil: newestDate(parsed.items, new Date()),
      });
    } catch (error) {
      if (isUniqueViolation(error)) return jsonError("Voce ja assina esse feed.", 409);
      throw error;
    }

    return NextResponse.json({ feeds: await list(session.id) }, { status: 201 });
  } catch (error) {
    return serverError("feeds/create", error);
  }
}

/** Cancela a assinatura: `?id=`. Os textos ja importados ficam. */
export async function DELETE(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!UUID_PATTERN.test(id)) return jsonError("Feed nao encontrado.", 404);

    await db.delete(feeds).where(and(eq(feeds.id, id), eq(feeds.userId, session.id)));
    return NextResponse.json({ feeds: await list(session.id) });
  } catch (error) {
    return serverError("feeds/delete", error);
  }
}
