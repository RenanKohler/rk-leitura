import { NextResponse } from "next/server";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, aiGate, AiUnavailable } from "@/lib/ai";
import { latestAiResult, saveAiResult } from "@/lib/ai-results";
import { consumeDailyQuota } from "@/lib/daily-quota";
import {
  asStoredSynthesis,
  highlightsFingerprint,
  MIN_HIGHLIGHTS_FOR_SYNTHESIS,
  type StoredSynthesis,
} from "@/lib/highlight-synthesis";
import { loadHighlights } from "@/lib/queries";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { synthesizeHighlights } from "@/lib/synthesis-generator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Gera a sintese dos destaques do texto (US-140).
 *
 * Uma por texto: a chave e o proprio texto, e a impressao do conjunto de
 * destaques vai no conteudo guardado. Pedir de novo com os mesmos destaques
 * devolve a guardada sem gastar cota; com destaques diferentes, gera outra no
 * lugar dela.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`sintese:${clientIp(request)}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitos pedidos seguidos. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);

    const loaded = await loadHighlights(session.id, id);
    if (!loaded) return jsonError("Texto não encontrado.", 404);
    if (loaded.items.length < MIN_HIGHLIGHTS_FOR_SYNTHESIS) {
      return jsonError(
        `A síntese precisa de pelo menos ${MIN_HIGHLIGHTS_FOR_SYNTHESIS} destaques.`,
        422
      );
    }

    const fingerprint = highlightsFingerprint(loaded.items);
    const previous = await latestAiResult<unknown>(session.id, id, "sintese");
    const stored = previous ? asStoredSynthesis(previous.payload) : null;
    if (stored && stored.fingerprint === fingerprint) {
      return NextResponse.json({ synthesis: stored });
    }

    // Sem permissao da conta (US-125), nada sai do app.
    const gate = await aiGate(session.id);
    if (gate) return gate;

    const quota = await consumeDailyQuota("resumo", session.id);
    if (!quota.allowed) {
      return jsonError(QUOTA_MESSAGES.resumo, 429, { retryAfter: quota.retryAfterSeconds });
    }

    const result = await synthesizeHighlights(session.id, loaded.text.title, loaded.items);
    const synthesis: StoredSynthesis = {
      ...result,
      fingerprint,
      count: loaded.items.length,
      createdAt: new Date().toISOString(),
    };
    await saveAiResult(session.id, id, "sintese", id, synthesis);

    return NextResponse.json({ synthesis });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/destaques/sintese", error);
  }
}
