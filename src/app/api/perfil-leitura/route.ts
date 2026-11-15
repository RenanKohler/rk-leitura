import { NextResponse } from "next/server";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, aiGate, AiUnavailable } from "@/lib/ai";
import { settleFailedCall, type ChargedCall } from "@/lib/ai-refund";
import { consumeDailyQuota } from "@/lib/daily-quota";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  cachedReadingProfile,
  generateReadingProfile,
  readingProfileState,
  readingProfileSummary,
} from "@/lib/reading-profile-queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Perfil de leitura do mes (US-234): o guardado do mes analisado, ou o que
 * falta para gerar, ou se o botao aparece. Nao chama o modelo.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    return NextResponse.json(await readingProfileState(session.id));
  } catch (error) {
    return serverError("perfil-leitura", error);
  }
}

/**
 * "Gerar perfil do mês": o guardado, se ja existe, ou um novo. Com pouco
 * dado responde 422 com o que falta, sem chamar o modelo nem gastar cota.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`perfil:${clientIp(request)}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitos pedidos seguidos. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  let charged: ChargedCall | null = null;
  try {
    const stored = await cachedReadingProfile(session.id);
    if (stored) return NextResponse.json({ profile: stored });

    const { window, summary, missing } = await readingProfileSummary(session.id);
    if (missing.length > 0) {
      return jsonError("Ainda não há dados suficientes para o perfil do mês.", 422, { missing });
    }

    // Sem permissao da conta (US-125), nada sai do app.
    const gate = await aiGate(session.id);
    if (gate) return gate;

    const quota = await consumeDailyQuota("resumo", session.id);
    if (!quota.allowed) {
      return jsonError(QUOTA_MESSAGES.resumo, 429, { retryAfter: quota.retryAfterSeconds });
    }
    charged = { userId: session.id, task: "perfil", quota: "resumo" };

    return NextResponse.json({ profile: await generateReadingProfile(session.id, window, summary) });
  } catch (error) {
    if (charged) await settleFailedCall(error, charged);
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("perfil-leitura", error);
  }
}
