import { NextResponse } from "next/server";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, aiGate, AiUnavailable } from "@/lib/ai";
import { batchStartNotice } from "@/lib/definition-batch";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { startDefinitionBatch } from "@/lib/word-batch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Busca em lote as definicoes das palavras guardadas sem ela (US-139).
 *
 * Responde assim que o lote e aceito: as definicoes chegam depois, conferidas
 * ao abrir Palavras e no acompanhamento de hora em hora.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`dicionario-lote:${clientIp(request)}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitos pedidos seguidos. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    // Sem permissao da conta (US-125), nada sai do app e nada e descontado.
    const gate = await aiGate(session.id);
    if (gate) return gate;

    const result = await startDefinitionBatch(session.id);
    switch (result.status) {
      case "busy":
        return jsonError("Já há um lote de definições em andamento.", 409);
      case "empty":
        return jsonError("Nenhuma palavra sem definição.", 422);
      case "quota":
        return jsonError(QUOTA_MESSAGES.dicionario, 429);
      case "started":
        return NextResponse.json({
          batched: result.batched,
          pending: result.pending,
          leftOut: result.pending - result.batched,
          wordIds: result.wordIds,
          message: batchStartNotice(result.batched, result.pending),
        });
    }
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("palavras/definicoes", error);
  }
}
