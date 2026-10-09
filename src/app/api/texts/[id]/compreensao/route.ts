import { NextResponse } from "next/server";
import { db } from "@/db";
import { comprehensionQuizzes } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { loadText } from "@/lib/queries";
import { consumeDailyQuota } from "@/lib/daily-quota";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { quizKey } from "@/lib/quiz";
import { parseParagraphs } from "@/lib/reading";
import { generateSessionQuiz } from "@/lib/quiz-generator";
import {
  MIN_SESSION_RANGE_WORDS,
  sessionExcerpt,
  sessionQuizKey,
  validSessionRange,
} from "@/lib/session-check";
import { cachedSessionQuiz, locateInRange } from "@/lib/session-quiz";
import { aiErrorResponse, aiGate, AiUnavailable } from "@/lib/ai";

export const dynamic = "force-dynamic";
// A geracao chama um modelo: pode passar dos 10s padrao das funcoes.
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Duas perguntas sobre o trecho lido numa sessao do Word Runner (US-149).
 *
 * Recebe o trecho (`from`, `to`) e manda ao modelo so as palavras dele. Fica
 * no mesmo cache do questionario, com uma chave por trecho, e conta na mesma
 * cota. Como no questionario, o gabarito nao sai daqui.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  // Mesmo limite do questionario: e a mesma chamada, com outro recorte.
  const limit = await rateLimit(`quiz:${clientIp(request)}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitos questionários seguidos. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);

    const text = await loadText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const body = await readJson<{ from?: unknown; to?: unknown }>(request);
    const { words } = parseParagraphs(text.content, text.format);
    const range = { from: body?.from, to: body?.to };
    if (!validSessionRange(range, words.length)) {
      return jsonError(
        `A checagem precisa de um trecho lido de pelo menos ${MIN_SESSION_RANGE_WORDS} palavras.`,
        422
      );
    }

    const key = sessionQuizKey(quizKey(text.content, text.language), range);
    let quiz = await cachedSessionQuiz(id, key);
    if (!quiz) {
      // Sem permissao da conta (US-125), nada sai do app.
      const gate = await aiGate(session.id);
      if (gate) return gate;

      const quota = await consumeDailyQuota("questionario", session.id);
      if (!quota.allowed) {
        return jsonError(QUOTA_MESSAGES.questionario, 429, {
          retryAfter: quota.retryAfterSeconds,
        });
      }

      const generated = await generateSessionQuiz(
        session.id,
        text.title,
        sessionExcerpt(words, range),
        text.language,
        id
      );
      quiz = locateInRange(generated, words, range);
      await db
        .insert(comprehensionQuizzes)
        .values({ textId: id, contentKey: key, questions: JSON.stringify(quiz) })
        .onConflictDoNothing();
    }

    return NextResponse.json({
      quiz: {
        questions: quiz.questions.map((question) => ({
          prompt: question.prompt,
          choices: question.choices,
        })),
      },
      questions: quiz.questions.length,
      from: range.from,
      to: range.to,
    });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/compreensao", error);
  }
}
