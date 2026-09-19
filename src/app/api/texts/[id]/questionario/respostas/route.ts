import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { comprehensionQuizzes, readingSessions } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { loadText } from "@/lib/queries";
import { contentKey, parseQuiz, scoreQuiz } from "@/lib/quiz";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Corrige as respostas no servidor e devolve o gabarito com a evidencia.
 *
 * A correcao nao pode acontecer no cliente: para conferir a resposta ele
 * precisaria do gabarito, e ai o questionario deixaria de medir qualquer
 * coisa.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const body = await readJson<{ answers?: unknown }>(request);
    const answers = Array.isArray(body?.answers) ? body.answers.map((value) => Number(value)) : null;
    if (!answers) return jsonError("Envie as respostas.", 400);

    const text = await loadText(session.id, id);
    if (!text) return jsonError("Texto nao encontrado.", 404);

    const [row] = await db
      .select({ questions: comprehensionQuizzes.questions })
      .from(comprehensionQuizzes)
      .where(
        and(
          eq(comprehensionQuizzes.textId, id),
          eq(comprehensionQuizzes.contentKey, contentKey(text.content))
        )
      )
      .limit(1);

    const quiz = row ? parseQuiz(row.questions) : null;
    if (!quiz) return jsonError("Peca o questionario antes de responder.", 409);

    const score = scoreQuiz(quiz, answers);

    // Anota na sessao mais recente deste texto, que e a leitura que acabou de
    // terminar. Sem sessao registrada o questionario ainda funciona - so nao
    // entra no historico.
    const [latest] = await db
      .select({ id: readingSessions.id })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, session.id), eq(readingSessions.textId, id)))
      .orderBy(desc(readingSessions.createdAt))
      .limit(1);

    if (latest) {
      await db
        .update(readingSessions)
        .set({ comprehension: score })
        .where(eq(readingSessions.id, latest.id));
    }

    return NextResponse.json({
      score,
      results: quiz.questions.map((question, index) => ({
        prompt: question.prompt,
        choices: question.choices,
        answer: question.answer,
        given: Number.isInteger(answers[index]) ? answers[index] : null,
        evidence: question.evidence,
      })),
    });
  } catch (error) {
    return serverError("texts/questionario/respostas", error);
  }
}
