import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { savedWords } from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { consumeDailyQuota } from "@/lib/daily-quota";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { lookupWord, LookupUnavailable } from "@/lib/word-lookup";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Busca de novo a definicao de uma palavra guardada sem ela (PROD-6).
 *
 * Usa a frase de origem guardada, como a consulta original faria. Falhar de
 * novo nao mexe em nada: a palavra continua na revisao com a definicao vazia.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  // Mesmo limite da consulta: e a mesma chamada ao dicionario.
  const limit = await rateLimit(`dicionario:${clientIp(request)}`, 120, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas consultas seguidas. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Palavra não encontrada.", 404);

    const owned = and(eq(savedWords.id, id), eq(savedWords.userId, session.id));
    const [word] = await db
      .select({ word: savedWords.word, context: savedWords.context, language: savedWords.language })
      .from(savedWords)
      .where(owned)
      .limit(1);
    if (!word) return jsonError("Palavra não encontrada.", 404);

    const quota = await consumeDailyQuota("dicionario", session.id);
    if (!quota.allowed) {
      return jsonError(QUOTA_MESSAGES.dicionario, 429, { retryAfter: quota.retryAfterSeconds });
    }

    const entry = await lookupWord(word.word, word.context ?? "", word.language);
    await db
      .update(savedWords)
      .set({
        base: entry.base,
        kind: entry.kind,
        definition: entry.definition,
        translation: entry.translation ?? null,
        updatedAt: new Date(),
      })
      .where(owned);

    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof LookupUnavailable) return jsonError(error.message, 503);
    return serverError("palavras/definicao", error);
  }
}
