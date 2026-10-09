import { NextResponse } from "next/server";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, AiUnavailable } from "@/lib/ai";
import { latestAiResult, saveAiResult } from "@/lib/ai-results";
import { loadText } from "@/lib/queries";
import { contentKey } from "@/lib/quiz";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { parseParagraphs } from "@/lib/reading";
import {
  buildNamesRequest,
  canReuseNames,
  clampPosition,
  namesKey,
  namesToDescribe,
  type NameDescriptions,
} from "@/lib/summaries";
import {
  admitSummary,
  generateNameDescriptions,
  summaryAvailability,
} from "@/lib/summary-generator";
import { namesInText } from "@/lib/xray";

export const dynamic = "force-dynamic";
// A geracao chama um modelo: pode passar dos 10s padrao das funcoes.
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Quem e quem ate onde li (US-132).
 *
 * A lista de nomes e a do X-Ray local (`xray.ts`), calculada aqui sobre o
 * mesmo conteudo que o leitor mostra; o modelo so descreve os nomes que ja
 * apareceram antes da posicao, com o trecho que termina nela.
 */
async function prepare(userId: string, id: string, rawPosition: unknown) {
  if (!UUID_PATTERN.test(id)) return null;
  const text = await loadText(userId, id);
  if (!text) return null;
  const position = clampPosition(rawPosition, text.wordCount);
  const key = contentKey(text.content);
  const latest = await latestAiResult<NameDescriptions>(userId, id, "nomes");
  const cached =
    latest && canReuseNames(latest.payload, key, position, text.wordCount) ? latest.payload : null;
  return { text, position, key, cached };
}

/**
 * Ao abrir a lista: as descricoes guardadas, quando ainda valem (menos de 10%
 * lido desde elas), e se da para pedir novas. Sem IA, a lista fica como hoje.
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
      return NextResponse.json({ available: true, descriptions: prepared.cached.descriptions });
    }
    const { available } = await summaryAvailability(session.id);
    return NextResponse.json({ available, descriptions: null });
  } catch (error) {
    return serverError("texts/nomes", error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`resumo:${clientIp(request)}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitos pedidos seguidos. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { posicao?: unknown };
    const prepared = await prepare(session.id, id, body.posicao);
    if (!prepared) return jsonError("Texto não encontrado.", 404);
    if (prepared.cached) return NextResponse.json({ descriptions: prepared.cached.descriptions });

    const { text, position, key } = prepared;
    const { words, paragraphs } = parseParagraphs(text.content, text.format);
    const { listed, sent } = namesToDescribe(namesInText(words, paragraphs), position);

    let descriptions: Record<string, string | null>;
    if (sent.length === 0) {
      // Nenhum nome apareceu ainda: nao ha o que perguntar, nem cota a gastar.
      descriptions = Object.fromEntries(listed.map((name) => [name, null]));
    } else {
      const refused = await admitSummary(session.id);
      if (refused) return refused;
      const built = buildNamesRequest({
        title: text.title,
        paragraphs,
        position,
        names: sent,
        language: text.language,
      });
      descriptions = await generateNameDescriptions(session.id, id, built, listed, sent);
    }

    const payload: NameDescriptions = { contentKey: key, position, descriptions };
    await saveAiResult(
      session.id,
      id,
      "nomes",
      namesKey(id, text.content, position, text.wordCount),
      payload
    );
    return NextResponse.json({ descriptions });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/nomes", error);
  }
}
