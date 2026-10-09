import { NextResponse } from "next/server";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { aiClient, aiErrorResponse, aiGate, AiUnavailable } from "@/lib/ai";
import { loadAiResult, saveAiResult } from "@/lib/ai-results";
import { consumeDailyQuota } from "@/lib/daily-quota";
import {
  explainRequest,
  explanationKey,
  followUpKey,
  normalizeFollowUp,
  parseExplanation,
  type Explanation,
  type FollowUp,
} from "@/lib/explain";
import { EXPLAIN_MESSAGES, streamExplanation, streamFollowUp } from "@/lib/explain-generator";
import { DEFAULT_LANGUAGE } from "@/lib/language";
import { loadText } from "@/lib/queries";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { parseParagraphs } from "@/lib/reading";
import { streamResponse } from "@/lib/stream-response";

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
 *
 * A explicacao nova chega em streaming (US-145): NDJSON com a frase, os
 * trechos de cada campo e o resultado validado no fim. Com `followUp`, pede
 * "Mais simples" ou "Dar um exemplo" sobre o mesmo recorte (US-146); cada
 * continuacao conta como uma explicacao.
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

    const body = await readJson<{ index?: unknown; followUp?: unknown }>(request);
    const index = Math.trunc(Number(body?.index));
    const followUp: FollowUp | null =
      body?.followUp === undefined ? null : normalizeFollowUp(body.followUp);
    if (body?.followUp !== undefined && !followUp) return jsonError("Pedido inválido.", 400);
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

    if (followUp) {
      const cachedFollowUp = await loadAiResult<{ text?: unknown }>(
        session.id,
        "explicacao",
        followUpKey(key, followUp)
      );
      if (typeof cachedFollowUp?.text === "string" && cachedFollowUp.text) {
        return NextResponse.json({ followUp, text: cachedFollowUp.text, cached: true });
      }
    } else if (known) {
      return NextResponse.json({ explanation: known, sentence: sentence.sentence, ...range, cached: true });
    }

    // Sem permissao da conta (US-125), nada sai do app.
    const gate = await aiGate(session.id);
    if (gate) return gate;
    // Sem chave, o erro sai antes do stream e sem gastar cota.
    aiClient(EXPLAIN_MESSAGES);

    // So a explicacao nova conta para o teto diario; cada continuacao tambem.
    const quota = await consumeDailyQuota("explicacao", session.id);
    if (!quota.allowed) {
      return jsonError(QUOTA_MESSAGES.explicacao, 429, { retryAfter: quota.retryAfterSeconds });
    }

    if (followUp) {
      return streamResponse(request, "texts/explicacao", async (emit, signal) => {
        const result = await streamFollowUp(session.id, sentence, followUp, known, {
          textId: id,
          signal,
          onDelta: (delta) => emit({ type: "delta", text: delta }),
        });
        await saveAiResult(session.id, id, "explicacao", followUpKey(key, followUp), { text: result });
        emit({ type: "done", followUp, text: result, cached: false });
      });
    }

    return streamResponse(request, "texts/explicacao", async (emit, signal) => {
      emit({ type: "start", sentence: sentence.sentence, ...range });
      const explanation = await streamExplanation(session.id, sentence, text.language, {
        textId: id,
        signal,
        onDelta: (field, delta) => emit({ type: "delta", field, text: delta }),
      });
      await saveAiResult(session.id, id, "explicacao", key, explanation);
      emit({ type: "done", explanation, sentence: sentence.sentence, ...range, cached: false });
    });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/explicacao", error);
  }
}
