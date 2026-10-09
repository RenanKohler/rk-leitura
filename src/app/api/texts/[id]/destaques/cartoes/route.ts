import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { highlights } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, aiGate, AiUnavailable } from "@/lib/ai";
import { generateHighlightCards } from "@/lib/card-generator";
import { consumeDailyQuota } from "@/lib/daily-quota";
import { MIN_HIGHLIGHTS_FOR_CARDS, parseCardEdits } from "@/lib/highlight-cards";
import { loadHighlights } from "@/lib/queries";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Gera os cartoes dos destaques do texto (US-150), sem gravar: a tela mostra
 * cada um para editar ou descartar, e so o que o leitor aprovar e salvo (PUT).
 * Uma chamada por pedido, na cota de resumos.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`cartoes:${clientIp(request)}`, 30, 60 * 60 * 1000);
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
    if (loaded.items.length < MIN_HIGHLIGHTS_FOR_CARDS) {
      return jsonError(`Destaque pelo menos ${MIN_HIGHLIGHTS_FOR_CARDS} trechos.`, 422);
    }

    // Sem permissao da conta (US-125), nada sai do app.
    const gate = await aiGate(session.id);
    if (gate) return gate;

    const quota = await consumeDailyQuota("resumo", session.id);
    if (!quota.allowed) {
      return jsonError(QUOTA_MESSAGES.resumo, 429, { retryAfter: quota.retryAfterSeconds });
    }

    const cards = await generateHighlightCards(session.id, id, loaded.text.title, loaded.items);
    return NextResponse.json({ cards });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/destaques/cartoes", error);
  }
}

/**
 * Salva os cartoes revisados pelo leitor em cada destaque de origem. Os
 * descartados nao vem; um destaque que ja tinha cartao fica com o novo.
 */
export async function PUT(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);

    const body = await readJson<{ cards?: unknown }>(request);
    const cards = parseCardEdits(body?.cards);
    if (!cards) return jsonError("Envie os cartões com pergunta e resposta.", 400);

    const owned = and(eq(highlights.userId, session.id), eq(highlights.textId, id));
    const ids = cards.map((card) => card.highlightId).filter((value) => UUID_PATTERN.test(value));
    const known = ids.length
      ? await db
          .select({ id: highlights.id })
          .from(highlights)
          .where(and(owned, inArray(highlights.id, ids)))
      : [];
    const valid = new Set(known.map((row) => row.id));
    if (valid.size !== cards.length) return jsonError("Destaque não encontrado.", 404);

    await db.transaction(async (tx) => {
      for (const card of cards) {
        await tx
          .update(highlights)
          .set({ cardPrompt: card.prompt, cardAnswer: card.answer })
          .where(and(owned, eq(highlights.id, card.highlightId)));
      }
    });

    return NextResponse.json({ saved: cards.length, cards });
  } catch (error) {
    return serverError("texts/destaques/cartoes/salvar", error);
  }
}
