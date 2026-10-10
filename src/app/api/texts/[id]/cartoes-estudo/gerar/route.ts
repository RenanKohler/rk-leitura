import { NextResponse } from "next/server";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { AI_DISABLED, aiConfigured, aiConsent, aiErrorResponse, aiGate, AiUnavailable } from "@/lib/ai";
import { consumeDailyQuota, readDailyUsage } from "@/lib/daily-quota";
import { DAILY_QUOTAS, QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { asStudyCardMode, MIN_WORDS_FOR_STUDY_CARDS } from "@/lib/study-card-drafts";
import { generateStudyCards, STUDY_CARDS_MESSAGES } from "@/lib/study-card-generator";
import { loadFronts, loadStudyText } from "@/lib/study-card-store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

const TOO_SHORT = `O texto precisa ter pelo menos ${MIN_WORDS_FOR_STUDY_CARDS} palavras.`;

/**
 * Pode gerar agora? Chave configurada, IA nao desligada na conta e cota
 * `estudo` sobrando. Consentimento pendente conta como disponivel: e o
 * pedido que abre o aviso. O motivo vai para a tela mostrar junto do botao.
 */
export async function GET(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    const text = await loadStudyText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const unavailable = (reason: string) => NextResponse.json({ available: false, reason });
    if (text.wordCount < MIN_WORDS_FOR_STUDY_CARDS) return unavailable(TOO_SHORT);
    if (!aiConfigured()) return unavailable(STUDY_CARDS_MESSAGES.notConfigured);
    if ((await aiConsent(session.id)) === "off") return unavailable(AI_DISABLED);
    const { used } = await readDailyUsage(session.id);
    if (used.estudo >= DAILY_QUOTAS.estudo) return unavailable(QUOTA_MESSAGES.estudo);
    return NextResponse.json({ available: true, reason: null });
  } catch (error) {
    return serverError("texts/cartoes-estudo/disponivel", error);
  }
}

/**
 * Gera os cartoes do texto completo (US-155, US-157), sem gravar: a tela
 * mostra cada um para editar ou descartar e so salva o que o leitor manteve.
 * Uma chamada por pedido, na cota `estudo`.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`cartoes-estudo:${clientIp(request)}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitos pedidos seguidos. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const { id } = await params;
    const text = await loadStudyText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);
    if (text.wordCount < MIN_WORDS_FOR_STUDY_CARDS) return jsonError(TOO_SHORT, 422);

    const body = await readJson<{ tipo?: unknown }>(request);
    const mode = asStudyCardMode(body?.tipo);

    // Sem permissao da conta (US-125), nada sai do app e nada e gasto.
    const gate = await aiGate(session.id);
    if (gate) return gate;
    // Sem chave a chamada falha logo adiante com a mensagem certa; a cota fica.
    if (aiConfigured()) {
      const quota = await consumeDailyQuota("estudo", session.id);
      if (!quota.allowed) {
        return jsonError(QUOTA_MESSAGES.estudo, 429, { retryAfter: quota.retryAfterSeconds });
      }
    }

    const cards = await generateStudyCards({
      userId: session.id,
      textId: text.id,
      title: text.title,
      content: text.content,
      format: text.format,
      language: text.language,
      mode,
      existingFronts: await loadFronts(session.id, text.id),
    });
    return NextResponse.json({ cards });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/cartoes-estudo/gerar", error);
  }
}
