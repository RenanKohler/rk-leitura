import { NextResponse } from "next/server";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, aiGate, AiUnavailable } from "@/lib/ai";
import { consumeDailyQuota } from "@/lib/daily-quota";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { MIN_WEEK_TEXTS } from "@/lib/week-ideas";
import {
  cachedWeekIdeas,
  generateWeekIdeas,
  weekIdeasState,
  weekReadCount,
} from "@/lib/week-ideas-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * Estado das ideias da semana para o cartao (US-154): se o botao aparece e o
 * paragrafo guardado, quando existe. O cartao e montado com o painel; este
 * pedido sai dele, sem atrasar o painel.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    return NextResponse.json(await weekIdeasState(session.id));
  } catch (error) {
    return serverError("resumo-semanal/ideias", error);
  }
}

/** "Ver as ideias da semana": o guardado, ou um paragrafo novo. */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`semana:${clientIp(request)}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitos pedidos seguidos. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const stored = await cachedWeekIdeas(session.id);
    if (stored) return NextResponse.json({ ideas: stored });

    if ((await weekReadCount(session.id)) < MIN_WEEK_TEXTS) {
      return jsonError(`As ideias da semana precisam de pelo menos ${MIN_WEEK_TEXTS} textos lidos.`, 422);
    }

    // Sem permissao da conta (US-125), nada sai do app.
    const gate = await aiGate(session.id);
    if (gate) return gate;

    const quota = await consumeDailyQuota("resumo", session.id);
    if (!quota.allowed) {
      return jsonError(QUOTA_MESSAGES.resumo, 429, { retryAfter: quota.retryAfterSeconds });
    }

    return NextResponse.json({ ideas: await generateWeekIdeas(session.id) });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("resumo-semanal/ideias", error);
  }
}
