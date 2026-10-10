import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { studyCards } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { aiClient, aiErrorResponse, aiGate, AiUnavailable } from "@/lib/ai";
import { analogyRequest, storedAnalogy } from "@/lib/analogy";
import { ANALOGY_MESSAGES, generateAnalogy } from "@/lib/analogy-generator";
import { consumeDailyQuota } from "@/lib/daily-quota";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { asTextFormat, parseParagraphs } from "@/lib/reading";
import { loadOwnedCard } from "@/lib/study-review-queries";

export const dynamic = "force-dynamic";
// A chamada ao modelo tem teto de 30s; a folga e para banco e rede.
export const maxDuration = 45;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * "Explicar de outro jeito" (US-168): uma analogia de ate 50 palavras para um
 * cartao errado. Leva so a frente, o verso e o trecho de origem; nada e
 * guardado ate o leitor tocar "Guardar no cartao" (PUT).
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`analogia:${clientIp(request)}`, 60, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitos pedidos seguidos. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Cartão não encontrado.", 404);

    const card = await loadOwnedCard(session.id, id);
    if (!card) return jsonError("Cartão não encontrado.", 404);
    if (!card.read) return jsonError("Este cartão é de um trecho que você ainda não leu.", 409);

    // Sem permissao da conta (US-125), nada sai do app.
    const gate = await aiGate(session.id);
    if (gate) return gate;
    // Sem chave, o erro sai antes e sem gastar cota.
    aiClient(ANALOGY_MESSAGES);

    const quota = await consumeDailyQuota("estudo", session.id);
    if (!quota.allowed) {
      return jsonError(QUOTA_MESSAGES.estudo, 429, { retryAfter: quota.retryAfterSeconds });
    }

    const words = parseParagraphs(card.content, asTextFormat(card.format)).words;
    const analogy = await generateAnalogy(
      session.id,
      analogyRequest({
        front: card.front,
        back: card.back,
        source: words.slice(card.sourceStart, card.sourceEnd).join(" "),
      }),
      card.textId
    );

    return NextResponse.json({ analogy });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("cartoes/analogia", error);
  }
}

/** Guarda a analogia no cartao: ela passa a aparecer no verso. */
export async function PUT(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Cartão não encontrado.", 404);

    const body = await readJson<{ analogy?: unknown }>(request);
    const analogy = storedAnalogy(body?.analogy);
    if (!analogy) return jsonError("Analogia inválida.", 400);

    const [updated] = await db
      .update(studyCards)
      .set({ analogy, updatedAt: new Date() })
      .where(and(eq(studyCards.id, id), eq(studyCards.userId, session.id)))
      .returning({ id: studyCards.id });
    if (!updated) return jsonError("Cartão não encontrado.", 404);

    return NextResponse.json({ analogy });
  } catch (error) {
    return serverError("cartoes/analogia/guardar", error);
  }
}
