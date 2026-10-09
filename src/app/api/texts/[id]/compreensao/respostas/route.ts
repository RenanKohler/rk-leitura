import { NextResponse } from "next/server";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { loadText } from "@/lib/queries";
import { quizKey, scoreQuiz } from "@/lib/quiz";
import { parseParagraphs } from "@/lib/reading";
import { recordComprehension, sessionIdFrom } from "@/lib/cloze-quiz";
import { sessionQuizKey, validSessionRange } from "@/lib/session-check";
import { cachedSessionQuiz } from "@/lib/session-quiz";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Corrige a checagem de uma sessao (US-149) no servidor e grava a nota na
 * sessao que a tela gravou ao abrir a checagem (`sessionId`). E essa sessao
 * que o treino mostra, com o ppm dela ao lado da nota.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);

    const body = await readJson<{
      answers?: unknown;
      from?: unknown;
      to?: unknown;
      sessionId?: unknown;
    }>(request);
    const answers = Array.isArray(body?.answers) ? body.answers.map((value) => Number(value)) : null;
    if (!answers) return jsonError("Envie as respostas.", 400);

    const text = await loadText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const { words } = parseParagraphs(text.content, text.format);
    const range = { from: body?.from, to: body?.to };
    if (!validSessionRange(range, words.length)) {
      return jsonError("Peça as perguntas antes de responder.", 409);
    }

    const quiz = await cachedSessionQuiz(
      id,
      sessionQuizKey(quizKey(text.content, text.language), range)
    );
    if (!quiz) return jsonError("Peça as perguntas antes de responder.", 409);

    const score = scoreQuiz(quiz, answers);
    // Sem sessao informada, nenhuma: a nota nao pode cair numa sessao alheia.
    await recordComprehension(session.id, id, score, sessionIdFrom(body?.sessionId) ?? null);

    return NextResponse.json({
      score,
      results: quiz.questions.map((question, index) => ({
        prompt: question.prompt,
        choices: question.choices,
        answer: question.answer,
        given: Number.isInteger(answers[index]) ? answers[index] : null,
        evidence: question.evidence,
        ...(question.rationale ? { rationale: question.rationale } : {}),
        ...(question.position ? { position: question.position } : {}),
      })),
    });
  } catch (error) {
    return serverError("texts/compreensao/respostas", error);
  }
}
