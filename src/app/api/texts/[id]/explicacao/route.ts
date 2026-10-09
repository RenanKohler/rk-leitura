import { NextResponse } from "next/server";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, aiGate, AiUnavailable } from "@/lib/ai";
import { loadAiResult, saveAiResult } from "@/lib/ai-results";
import { consumeDailyQuota } from "@/lib/daily-quota";
import { explainRequest, explanationKey, parseExplanation, type Explanation } from "@/lib/explain";
import { explainSentence } from "@/lib/explain-generator";
import { DEFAULT_LANGUAGE } from "@/lib/language";
import { loadText } from "@/lib/queries";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { parseParagraphs } from "@/lib/reading";

export const dynamic = "force-dynamic";
// A chamada ao modelo tem teto de 30s; a folga e para banco e rede.
export const maxDuration = 45;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Explica a frase que contem a palavra `index` (US-127).
 *
 * A frase e o contexto saem do texto no banco, nunca do cliente: o pedido ao
 * modelo leva so a frase e o que veio antes dela. A mesma frase do mesmo
 * conteudo volta do banco sem chamada nova e sem gastar cota.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`explicacao:${clientIp(request)}`, 120, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas explicações seguidas. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);

    const body = await readJson<{ index?: unknown }>(request);
    const index = Math.trunc(Number(body?.index));
    if (!Number.isFinite(index) || index < 0) {
      return jsonError("Toque em uma palavra da frase.", 400);
    }

    const text = await loadText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const { words, paragraphs } = parseParagraphs(text.content, text.format);
    if (index >= words.length) return jsonError("Toque em uma palavra da frase.", 400);

    const sentence = explainRequest(words, paragraphs, index, text.language);
    if (!sentence) return jsonError("Toque em uma palavra da frase.", 400);
    const range = { start: sentence.start, end: sentence.end };

    const key = explanationKey(id, text.content, text.language, range);
    const foreign = text.language !== DEFAULT_LANGUAGE;
    const known = parseExplanation(await loadAiResult<Explanation>(session.id, "explicacao", key), foreign);
    if (known) {
      return NextResponse.json({ explanation: known, sentence: sentence.sentence, ...range, cached: true });
    }

    // Sem permissao da conta (US-125), nada sai do app.
    const gate = await aiGate(session.id);
    if (gate) return gate;

    // So a explicacao nova conta para o teto diario.
    const quota = await consumeDailyQuota("explicacao", session.id);
    if (!quota.allowed) {
      return jsonError(QUOTA_MESSAGES.explicacao, 429, { retryAfter: quota.retryAfterSeconds });
    }

    const explanation = await explainSentence(session.id, sentence, text.language);
    await saveAiResult(session.id, id, "explicacao", key, explanation);

    return NextResponse.json({ explanation, sentence: sentence.sentence, ...range, cached: false });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/explicacao", error);
  }
}
