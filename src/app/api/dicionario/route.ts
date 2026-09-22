import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { savedWords, texts } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { consumeDailyQuota } from "@/lib/daily-quota";
import { DEFAULT_LANGUAGE } from "@/lib/language";
import { todayIn } from "@/lib/goals";
import { loadSavedWords, loadSettings } from "@/lib/queries";
import { firstReview } from "@/lib/vocabulary";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { normalizeWord, trimContext, wordKey } from "@/lib/dictionary";
import { lookupWord, LookupUnavailable } from "@/lib/word-lookup";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Palavras salvas, da mais recente para a mais antiga. */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    return NextResponse.json({ words: await loadSavedWords(session.id) });
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
    const requestedTextId =
      typeof body?.textId === "string" && UUID_PATTERN.test(body.textId) ? body.textId : null;

    // O idioma vem do texto no banco, nao do cliente (US-69). Texto de outra
    // conta ou apagado nao conta: a consulta segue em portugues, sem vinculo.
    const [source] = requestedTextId
      ? await db
          .select({ id: texts.id, language: texts.language })
          .from(texts)
          .where(and(eq(texts.id, requestedTextId), eq(texts.userId, session.id)))
          .limit(1)
      : [];
    const textId = source?.id ?? null;
    const language = source?.language ?? DEFAULT_LANGUAGE;

    const folded = wordKey(word);
    const [known] = await db
      .select()
      .from(savedWords)
      .where(
        and(
          eq(savedWords.userId, session.id),
          eq(savedWords.language, language),
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
          translation: known.translation,
        },
        cached: true,
      });
    }

    // Palavra ja consultada voltou acima sem gastar cota; so a chamada nova conta.
    const quota = await consumeDailyQuota("dicionario", session.id);
    if (!quota.allowed) {
      return jsonError(QUOTA_MESSAGES.dicionario, 429, { retryAfter: quota.retryAfterSeconds });
    }

    const entry = await lookupWord(word, context, language);

    await db
      .insert(savedWords)
      .values({
        userId: session.id,
        word: entry.word,
        base: entry.base,
        kind: entry.kind,
        definition: entry.definition,
        translation: entry.translation ?? null,
        language,
        textId,
        // A frase volta na revisao (US-64); a primeira e no dia seguinte.
        context: context || null,
        nextReviewOn: firstReview(todayIn((await loadSettings(session.id))?.timezone ?? "UTC"))
          .nextReviewOn,
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
