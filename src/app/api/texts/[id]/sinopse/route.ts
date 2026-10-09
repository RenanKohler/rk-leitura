import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, aiGate, AiUnavailable } from "@/lib/ai";
import { consumeDailyQuota } from "@/lib/daily-quota";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { canAskSynopsis, MIN_SYNOPSIS_WORDS } from "@/lib/synopsis";
import { cachedSynopsis, generateSynopsis } from "@/lib/synopsis-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * "Do que se trata?" no cartao da biblioteca (US-138).
 *
 * Sob demanda e uma vez por versao do conteudo: pedir de novo devolve a
 * guardada, sem cota. So vale para texto nao iniciado - depois de comecar,
 * quem le ja sabe do que se trata.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`sinopse:${clientIp(request)}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas sinopses seguidas. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);

    const [text] = await db
      .select({
        title: texts.title,
        content: texts.content,
        wordCount: texts.wordCount,
        progressIndex: texts.progressIndex,
      })
      .from(texts)
      .where(and(eq(texts.id, id), eq(texts.userId, session.id)))
      .limit(1);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const stored = await cachedSynopsis(session.id, id, text.content);
    if (stored) return NextResponse.json({ synopsis: stored });

    if (text.wordCount < MIN_SYNOPSIS_WORDS) {
      return jsonError(`A sinopse precisa de pelo menos ${MIN_SYNOPSIS_WORDS} palavras.`, 422);
    }
    if (!canAskSynopsis(text)) {
      return jsonError("A sinopse é só para textos que você ainda não começou.", 409);
    }

    // Sem permissao da conta (US-125), nada sai do app.
    const gate = await aiGate(session.id);
    if (gate) return gate;

    const quota = await consumeDailyQuota("resumo", session.id);
    if (!quota.allowed) {
      return jsonError(QUOTA_MESSAGES.resumo, 429, { retryAfter: quota.retryAfterSeconds });
    }

    const synopsis = await generateSynopsis(session.id, id, text.title, text.content);
    return NextResponse.json({ synopsis });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/sinopse", error);
  }
}
