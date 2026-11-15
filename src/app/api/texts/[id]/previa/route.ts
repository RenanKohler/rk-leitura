import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { aiConfigured, aiConsent, aiErrorResponse, aiGate, AiUnavailable } from "@/lib/ai";
import { settleFailedCall, type ChargedCall } from "@/lib/ai-refund";
import { consumeDailyQuota, readDailyUsage } from "@/lib/daily-quota";
import { canAskPreview, MIN_PREVIEW_WORDS } from "@/lib/preview";
import { cachedPreview, generatePreview } from "@/lib/preview-ai";
import { DAILY_QUOTAS, QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

async function loadOwned(userId: string, id: string) {
  if (!UUID_PATTERN.test(id)) return null;
  const [text] = await db
    .select({
      title: texts.title,
      content: texts.content,
      wordCount: texts.wordCount,
      progressIndex: texts.progressIndex,
    })
    .from(texts)
    .where(and(eq(texts.id, id), eq(texts.userId, userId)))
    .limit(1);
  return text ?? null;
}

/**
 * Previa antes de ler (US-233). O leitor pergunta ao abrir: a previa
 * guardada volta sempre (as duas perguntas seguem acessiveis durante a
 * leitura), e `available` diz se o botao "Ver prévia" deve aparecer - so em
 * texto nao comecado, com a IA ligada e cota sobrando. Nada e gerado aqui.
 */
export async function GET(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  try {
    const { id } = await params;
    const text = await loadOwned(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const preview = await cachedPreview(session.id, id, text.content);
    if (preview) return NextResponse.json({ preview, available: true });
    if (!canAskPreview(text) || !aiConfigured()) {
      return NextResponse.json({ preview: null, available: false });
    }
    if ((await aiConsent(session.id)) === "off") {
      return NextResponse.json({ preview: null, available: false });
    }
    const { used } = await readDailyUsage(session.id);
    return NextResponse.json({ preview: null, available: used.resumo < DAILY_QUOTAS.resumo });
  } catch (error) {
    return serverError("texts/previa", error);
  }
}

/**
 * "Ver prévia" (US-233): sob demanda e uma vez por versao do conteudo. Pedir
 * de novo devolve a guardada, sem cota. So o comeco do texto vai ao modelo.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`previa:${clientIp(request)}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas prévias seguidas. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  let charged: ChargedCall | null = null;
  try {
    const { id } = await params;
    const text = await loadOwned(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const stored = await cachedPreview(session.id, id, text.content);
    if (stored) return NextResponse.json({ preview: stored });

    if (text.wordCount < MIN_PREVIEW_WORDS) {
      return jsonError(`A prévia precisa de pelo menos ${MIN_PREVIEW_WORDS} palavras.`, 422);
    }
    if (!canAskPreview(text)) {
      return jsonError("A prévia é só para textos que você ainda não começou.", 409);
    }

    // Sem permissao da conta (US-125), nada sai do app.
    const gate = await aiGate(session.id);
    if (gate) return gate;

    const quota = await consumeDailyQuota("resumo", session.id);
    if (!quota.allowed) {
      return jsonError(QUOTA_MESSAGES.resumo, 429, { retryAfter: quota.retryAfterSeconds });
    }
    charged = { userId: session.id, task: "previa", quota: "resumo" };

    const preview = await generatePreview(session.id, id, text.title, text.content);
    return NextResponse.json({ preview });
  } catch (error) {
    if (charged) await settleFailedCall(error, charged);
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/previa", error);
  }
}
