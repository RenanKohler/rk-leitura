import { NextResponse } from "next/server";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, AiUnavailable } from "@/lib/ai";
import { loadAiResult, saveAiResult } from "@/lib/ai-results";
import { loadText } from "@/lib/queries";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { parseParagraphs } from "@/lib/reading";
import { buildChapterSummaryRequest, chapterSummaryKey } from "@/lib/summaries";
import { admitSummary, generateChapterSummary } from "@/lib/summary-generator";

export const dynamic = "force-dynamic";
// A geracao chama um modelo: pode passar dos 10s padrao das funcoes.
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Resumo de um capitulo concluido (US-131), pedido pela recapitulacao do
 * capitulo seguinte. O `id` e o do capitulo anterior.
 *
 * So capitulo lido ate o fim: e isso que permite mandar o capitulo inteiro
 * sem revelar nada que o leitor nao tenha lido. O cache e por (texto,
 * impressao do conteudo) - editar ou continuar o capitulo gera um resumo novo.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`resumo:${clientIp(request)}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitos resumos seguidos. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);
    const text = await loadText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);
    if (text.wordCount === 0 || text.progressIndex < text.wordCount) {
      return jsonError("O resumo do capítulo vale só para capítulo concluído.", 422);
    }

    const key = chapterSummaryKey(id, text.content);
    const stored = await loadAiResult<{ points: string[] }>(session.id, "capitulo", key);
    if (stored && Array.isArray(stored.points)) return NextResponse.json({ summary: stored });

    const refused = await admitSummary(session.id);
    if (refused) return refused;

    const { paragraphs } = parseParagraphs(text.content, text.format);
    const built = buildChapterSummaryRequest({
      title: text.title,
      paragraphs,
      wordCount: text.wordCount,
      language: text.language,
    });
    const summary = { points: await generateChapterSummary(session.id, id, built) };
    await saveAiResult(session.id, id, "capitulo", key, summary);
    return NextResponse.json({ summary });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/resumo-capitulo", error);
  }
}
