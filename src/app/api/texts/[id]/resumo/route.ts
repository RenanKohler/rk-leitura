import { NextResponse } from "next/server";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, AiUnavailable } from "@/lib/ai";
import { loadAiResult, saveAiResult } from "@/lib/ai-results";
import { loadText } from "@/lib/queries";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { parseParagraphs } from "@/lib/reading";
import {
  buildReadSummaryRequest,
  canReuseReadSummary,
  clampPosition,
  readSummaryKey,
  type ReadSummary,
} from "@/lib/summaries";
import { admitSummary, generateReadSummary, summaryAvailability } from "@/lib/summary-generator";

export const dynamic = "force-dynamic";
// A geracao chama um modelo: pode passar dos 10s padrao das funcoes.
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Abaixo disso nao ha o que resumir: o cartao de recapitulacao nem aparece. */
const MIN_WORDS = 40;

type Params = { params: Promise<{ id: string }> };

/**
 * Resumo do que ja li ao retomar um texto (US-130).
 *
 * A posicao vem da tela, mas nunca passa da posicao salva: o resumo cobre o
 * que foi lido, e o recorte termina exatamente nela.
 */
async function prepare(userId: string, id: string, rawPosition: unknown) {
  if (!UUID_PATTERN.test(id)) return null;
  const text = await loadText(userId, id);
  if (!text) return null;
  const position = Math.min(clampPosition(rawPosition, text.wordCount), text.progressIndex);
  const { paragraphs } = parseParagraphs(text.content, text.format);
  const key = readSummaryKey(id, text.content, paragraphs, position);
  const stored = await loadAiResult<ReadSummary>(userId, "resumo", key);
  return {
    text,
    paragraphs,
    position,
    key,
    cached: canReuseReadSummary(stored, position) ? stored : null,
  };
}

/**
 * O cartao pergunta antes de oferecer o botao: com a IA indisponivel, sem
 * cota ou desligada, ele mostra so Recapitular e Pular. Um resumo ja guardado
 * vem junto e vale mesmo sem cota - ler do banco nao gasta nada.
 */
export async function GET(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    const position = new URL(request.url).searchParams.get("posicao");
    const prepared = await prepare(session.id, id, position);
    if (!prepared) return jsonError("Texto não encontrado.", 404);

    if (prepared.cached) {
      return NextResponse.json({ available: true, summary: prepared.cached });
    }
    if (prepared.position < MIN_WORDS) return NextResponse.json({ available: false, summary: null });
    const { available } = await summaryAvailability(session.id);
    return NextResponse.json({ available, summary: null });
  } catch (error) {
    return serverError("texts/resumo", error);
  }
}

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
    const body = (await request.json().catch(() => ({}))) as { posicao?: unknown };
    const prepared = await prepare(session.id, id, body.posicao);
    if (!prepared) return jsonError("Texto não encontrado.", 404);
    if (prepared.cached) return NextResponse.json({ summary: prepared.cached });
    if (prepared.position < MIN_WORDS) return jsonError("Ainda não há o que resumir.", 422);

    // Sem permissao da conta (US-125) ou sem cota, nada sai do app.
    const refused = await admitSummary(session.id);
    if (refused) return refused;

    const built = buildReadSummaryRequest({
      title: prepared.text.title,
      paragraphs: prepared.paragraphs,
      position: prepared.position,
      language: prepared.text.language,
    });
    const summary: ReadSummary = {
      points: await generateReadSummary(session.id, built),
      to: built.excerpt.endWord,
    };
    await saveAiResult(session.id, id, "resumo", prepared.key, summary);
    return NextResponse.json({ summary });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/resumo", error);
  }
}
