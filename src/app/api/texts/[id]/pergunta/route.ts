import { NextResponse } from "next/server";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import {
  aiClient,
  aiErrorResponse,
  aiGate,
  aiStream,
  AiUnavailable,
  countWords,
  type AiMessages,
} from "@/lib/ai";
import {
  ASK_FAILURE,
  askExcerpt,
  askMessages,
  MAX_QUESTION_CHARS,
  MAX_QUESTIONS,
  NO_ANSWER,
  normalizeHistory,
  normalizeQuestion,
  readAnswer,
} from "@/lib/ask";
import { clearTurns, loadTurns, saveTurn } from "@/lib/ask-turns";
import { consumeDailyQuota } from "@/lib/daily-quota";
import { DEFAULT_LANGUAGE, languageName } from "@/lib/language";
import { loadText } from "@/lib/queries";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { contentKey } from "@/lib/quiz";
import { parseParagraphs } from "@/lib/reading";
import { streamResponse } from "@/lib/stream-response";

export const dynamic = "force-dynamic";
// Pergunta sobre um trecho longo, no modelo maior: pode passar de 30s.
export const maxDuration = 90;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

const MESSAGES: AiMessages = {
  notConfigured: "Perguntar ao texto não está configurado nesta instalação.",
  refusal: "Não consigo responder a esta pergunta.",
  failure: ASK_FAILURE,
};

function system(language: string): string {
  const lines = [
    "Você responde perguntas de quem está lendo um texto, usando só o documento enviado: o trecho que a pessoa já leu.",
    "O documento termina onde a leitura parou. Não suponha nem antecipe o que vem depois.",
    "Responda em português do Brasil, em poucas frases, e cite os trechos do documento que sustentam cada afirmação.",
    `Quando o documento não responde à pergunta, responda exatamente: "${NO_ANSWER}"`,
  ];
  if (language !== DEFAULT_LANGUAGE) {
    lines.push(
      `O documento está em ${languageName(language).toLowerCase()}: a resposta continua em português, e as citações ficam no idioma original.`
    );
  }
  return lines.join(" ");
}

/**
 * Responde uma pergunta sobre o que ja foi lido (US-128).
 *
 * O documento vem do banco e termina na palavra `position`, inclusive: nada
 * depois da posicao de leitura sai do app. A rota recebe o historico da
 * sessao da folha a cada pergunta.
 *
 * A resposta chega em streaming (US-145): NDJSON com os trechos de texto e,
 * no fim, a resposta com as citacoes ja em posicoes do texto. A pergunta
 * respondida fica guardada com a posicao e a impressao do conteudo (US-147).
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`pergunta:${clientIp(request)}`, 60, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas perguntas seguidas. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);

    const body = await readJson<{ question?: unknown; position?: unknown; history?: unknown }>(
      request
    );
    const question = normalizeQuestion(body?.question);
    if (!question) {
      return jsonError(`Escreva uma pergunta de até ${MAX_QUESTION_CHARS} caracteres.`, 400);
    }
    const history = normalizeHistory(body?.history);
    if (!history) return jsonError("Conversa inválida. Comece outra.", 400);
    if (history.length >= MAX_QUESTIONS) {
      return jsonError(`Até ${MAX_QUESTIONS} perguntas por conversa. Comece outra.`, 400);
    }
    const position = Math.trunc(Number(body?.position));
    if (!Number.isFinite(position) || position < 0) {
      return jsonError("Posição de leitura inválida.", 400);
    }

    const text = await loadText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const { paragraphs } = parseParagraphs(text.content, text.format);
    const excerpt = askExcerpt(paragraphs, position);
    if (excerpt.text.length === 0) return jsonError("Leia um pouco antes de perguntar.", 400);

    // Sem permissao da conta (US-125), nada sai do app.
    const gate = await aiGate(session.id);
    if (gate) return gate;
    // Sem chave, o erro sai antes do stream e sem gastar cota.
    aiClient(MESSAGES);

    const quota = await consumeDailyQuota("pergunta", session.id);
    if (!quota.allowed) {
      return jsonError(QUOTA_MESSAGES.pergunta, 429, { retryAfter: quota.retryAfterSeconds });
    }

    const fingerprint = contentKey(text.content);
    return streamResponse(request, "texts/pergunta", async (emit, signal) => {
      const response = await aiStream({
        task: "pergunta",
        userId: session.id,
        textId: id,
        wordsSent: countWords(excerpt.text),
        messages: MESSAGES,
        system: system(text.language),
        maxTokens: 4000,
        effort: "medium",
        timeoutMs: 75_000,
        signal,
        content: askMessages(excerpt, text.title, history, question),
        onText: (delta) => emit({ type: "delta", text: delta }),
      });

      const answer = readAnswer(response.content, excerpt);
      let turn = null;
      try {
        turn = await saveTurn(session.id, id, { question, answer, position, fingerprint });
      } catch (error) {
        // A resposta vale mesmo sem ficar guardada.
        console.error("[ia] falha ao guardar a pergunta:", error);
      }
      emit({ type: "done", answer, recentOnly: excerpt.truncated, turn });
    });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/pergunta", error);
  }
}

/** Conversa guardada do texto (US-147). */
export async function GET(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);
    const text = await loadText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);
    const turns = await loadTurns(session.id, id, contentKey(text.content));
    return NextResponse.json({ turns });
  } catch (error) {
    return serverError("texts/pergunta", error);
  }
}

/** "Limpar conversa": apaga as perguntas guardadas do texto (US-147). */
export async function DELETE(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);
    const text = await loadText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);
    await clearTurns(session.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError("texts/pergunta", error);
  }
}
