import { NextResponse } from "next/server";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, AiUnavailable } from "@/lib/ai";
import {
  cardProposal,
  MAX_PASSAGE_WORDS,
  PASSAGE_TOO_LONG,
  passageExcerpt,
  passageSpan,
  passageWords,
} from "@/lib/passage-card";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { CARD_MESSAGES, proposeCard } from "@/lib/study-ai";
import { loadStudyText, studyGate } from "@/lib/study-tools";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

/**
 * "Criar cartao" sobre um trecho selecionado (US-158): devolve a proposta de
 * frente e verso, sem gravar. O pedido leva o trecho e o paragrafo anterior,
 * nada depois. Trecho de mais de 300 palavras e recusado antes de qualquer
 * envio.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`cartao:${clientIp(request)}`, 60, 60 * 60 * 1000);
  if (!limit.allowed) return jsonError("Muitos pedidos seguidos. Aguarde um pouco.", 429);

  try {
    const { id } = await params;
    const text = await loadStudyText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const body = await readJson<{ start?: unknown; end?: unknown }>(request);
    const span = passageSpan(body, text.words.length);
    if (!span) return jsonError("Trecho inválido.", 400);
    if (passageWords(span) > MAX_PASSAGE_WORDS) return jsonError(PASSAGE_TOO_LONG, 400);

    const blocked = await studyGate(session.id, CARD_MESSAGES);
    if (blocked) return blocked;

    const excerpt = passageExcerpt(text.paragraphs, span);
    const proposal = cardProposal(
      await proposeCard(session.id, id, text.title, excerpt, text.language)
    );
    if (!proposal) return jsonError(CARD_MESSAGES.failure, 503);
    return NextResponse.json({ proposal });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/cartao", error);
  }
}
