import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { savedWords, texts } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { consumeDailyQuota } from "@/lib/daily-quota";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { MAX_SAVED_WORDS, normalizeWord, trimContext, wordKey } from "@/lib/dictionary";
import { lookupWord, LookupUnavailable } from "@/lib/word-lookup";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Palavras salvas, da mais recente para a mais antiga. */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const rows = await db
      .select({
        id: savedWords.id,
        word: savedWords.word,
        base: savedWords.base,
        kind: savedWords.kind,
        definition: savedWords.definition,
        textId: savedWords.textId,
        textTitle: texts.title,
        createdAt: savedWords.createdAt,
      })
      .from(savedWords)
      .leftJoin(texts, eq(texts.id, savedWords.textId))
      .where(eq(savedWords.userId, session.id))
      .orderBy(desc(savedWords.updatedAt))
      .limit(MAX_SAVED_WORDS);

    return NextResponse.json({
      words: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    });
  } catch (error) {
    return serverError("dicionario/list", error);
  }
}

/**
 * Consulta uma palavra e guarda o resultado.
 *
 * A palavra ja consultada volta do banco sem nova chamada ao modelo: o mesmo
 * leitor costuma tropecar na mesma palavra mais de uma vez, e a definicao nao
 * muda entre uma e outra.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`dicionario:${clientIp(request)}`, 120, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas consultas seguidas. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const body = await readJson<{ word?: unknown; context?: unknown; textId?: unknown }>(
      request
    );

    const word = normalizeWord(body?.word);
    if (!word) return jsonError("Toque em uma palavra para consultar.", 400);

    const context = trimContext(body?.context);
    const textId =
      typeof body?.textId === "string" && UUID_PATTERN.test(body.textId) ? body.textId : null;

    const folded = wordKey(word);
    const [known] = await db
      .select()
      .from(savedWords)
      .where(
        and(
          eq(savedWords.userId, session.id),
          sql`translate(lower(${savedWords.word}), 'áàâãäåéèêëíìîïóòôõöøúùûüçñýÿ', 'aaaaaaeeeeiiiioooooouuuucnyy') = ${folded}`
        )
      )
      .limit(1);

    if (known) {
      return NextResponse.json({
        entry: {
          word: known.word,
          base: known.base,
          kind: known.kind,
          definition: known.definition,
        },
        cached: true,
      });
    }

    // Palavra ja consultada voltou acima sem gastar cota; so a chamada nova conta.
    const quota = await consumeDailyQuota("dicionario", session.id);
    if (!quota.allowed) {
      return jsonError(QUOTA_MESSAGES.dicionario, 429, { retryAfter: quota.retryAfterSeconds });
    }

    const entry = await lookupWord(word, context);

    await db
      .insert(savedWords)
      .values({
        userId: session.id,
        word: entry.word,
        base: entry.base,
        kind: entry.kind,
        definition: entry.definition,
        textId,
      })
      .onConflictDoNothing();

    return NextResponse.json({ entry, cached: false });
  } catch (error) {
    if (error instanceof LookupUnavailable) return jsonError(error.message, 503);
    return serverError("dicionario/post", error);
  }
}

/** Tira a palavra da lista. */
export async function DELETE(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!UUID_PATTERN.test(id)) return jsonError("Palavra nao encontrada.", 404);

    const removed = await db
      .delete(savedWords)
      .where(and(eq(savedWords.id, id), eq(savedWords.userId, session.id)))
      .returning({ id: savedWords.id });

    if (removed.length === 0) return jsonError("Palavra nao encontrada.", 404);
    return NextResponse.json({ success: true });
  } catch (error) {
    return serverError("dicionario/delete", error);
  }
}
