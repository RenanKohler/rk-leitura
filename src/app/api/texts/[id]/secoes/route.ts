import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, aiGate, AiUnavailable } from "@/lib/ai";
import { consumeDailyQuota } from "@/lib/daily-quota";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { asTextFormat, parseParagraphs } from "@/lib/reading";
import { canSuggestSections, MIN_SECTION_WORDS, storedSections } from "@/lib/sections";
import { cachedSections, generateSections } from "@/lib/sections-ai";

export const dynamic = "force-dynamic";
// Acima de 200 mil caracteres o pedido vai em partes, uma depois da outra.
export const maxDuration = 120;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

async function loadOwned(userId: string, id: string) {
  const [text] = await db
    .select({
      content: texts.content,
      format: texts.format,
      wordCount: texts.wordCount,
      sections: texts.sections,
    })
    .from(texts)
    .where(and(eq(texts.id, id), eq(texts.userId, userId)))
    .limit(1);
  if (!text) return null;
  const { paragraphs } = parseParagraphs(text.content, asTextFormat(text.format));
  return { ...text, paragraphs };
}

/** Secoes aplicadas que ainda valem e se o texto pode pedir secoes (US-153). */
export async function GET(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);
    const text = await loadOwned(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    return NextResponse.json({
      sections: storedSections(text.sections, text.paragraphs),
      eligible: canSuggestSections(text.wordCount, text.paragraphs),
    });
  } catch (error) {
    return serverError("texts/secoes", error);
  }
}

/**
 * "Sugerir secoes" (US-153): devolve as sugestoes para revisao, sem aplicar.
 * A sugestao guardada para o conteudo atual volta sem cota.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`secoes:${clientIp(request)}`, 20, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitos pedidos de seções seguidos. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);
    const text = await loadOwned(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    if (text.wordCount < MIN_SECTION_WORDS) {
      return jsonError(`As seções são para textos com pelo menos ${MIN_SECTION_WORDS} palavras.`, 422);
    }
    if (!canSuggestSections(text.wordCount, text.paragraphs)) {
      return jsonError("Este texto já tem títulos.", 409);
    }

    const stored = await cachedSections(session.id, id, text.content);
    if (stored) return NextResponse.json({ suggestions: stored });

    // Sem permissao da conta (US-125), nada sai do app.
    const gate = await aiGate(session.id);
    if (gate) return gate;

    const quota = await consumeDailyQuota("resumo", session.id);
    if (!quota.allowed) {
      return jsonError(QUOTA_MESSAGES.resumo, 429, { retryAfter: quota.retryAfterSeconds });
    }

    const suggestions = await generateSections(session.id, id, text.content, text.paragraphs);
    return NextResponse.json({ suggestions });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/secoes", error);
  }
}

/**
 * Aplica as secoes revisadas. Grava so a marcacao de navegacao: o conteudo,
 * a contagem e as posicoes nao mudam. Lista vazia tira as secoes.
 */
export async function PUT(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);
    const body = await readJson<{ sections?: unknown }>(request);
    if (!Array.isArray(body?.sections)) return jsonError("Informe as seções.", 400);

    const text = await loadOwned(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);
    if (!canSuggestSections(text.wordCount, text.paragraphs)) {
      return jsonError("Este texto já tem títulos.", 409);
    }

    const sections = storedSections(body.sections, text.paragraphs);
    await db
      .update(texts)
      .set({ sections: sections.length > 0 ? sections : null })
      .where(and(eq(texts.id, id), eq(texts.userId, session.id)));

    return NextResponse.json({ sections });
  } catch (error) {
    return serverError("texts/secoes", error);
  }
}
