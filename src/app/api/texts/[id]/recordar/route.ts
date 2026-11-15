import { NextResponse } from "next/server";
import { db } from "@/db";
import { quizRecalls } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { recallQuestions, recallSeed, scoreRecall } from "@/lib/quiz-recall";
import { loadDueRecall } from "@/lib/study-review-queries";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

const NOT_DUE = "Nenhum questionário para recordar neste texto hoje.";

/**
 * Questionario refeito 7 ou 30 dias depois da conclusao (US-169).
 *
 * Usa o questionario guardado, sem chamada ao modelo, com as alternativas
 * reembaralhadas. Como no questionario original, o gabarito nao sai no GET.
 */
export async function GET(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);

    const recall = await loadDueRecall(session.id, id);
    if (!recall) return jsonError(NOT_DUE, 404);

    const questions = recallQuestions(recall.quiz, recallSeed(id, recall.round));
    return NextResponse.json({
      round: recall.round,
      title: recall.title,
      original: recall.original,
      questions: questions.map(({ prompt, choices }) => ({ prompt, choices })),
    });
  } catch (error) {
    return serverError("texts/recordar", error);
  }
}

/**
 * Corrige e guarda a nota da rodada em `quiz_recalls`. A nota fica fora das
 * sessoes de leitura, e por isso fora da media de compreensao do treino.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);

    const body = await readJson<{ answers?: unknown }>(request);
    const answers = Array.isArray(body?.answers) ? body.answers.map((value) => Number(value)) : null;
    if (!answers) return jsonError("Envie as respostas.", 400);

    const recall = await loadDueRecall(session.id, id);
    if (!recall) return jsonError(NOT_DUE, 404);

    const questions = recallQuestions(recall.quiz, recallSeed(id, recall.round));
    const score = scoreRecall(questions, answers);

    await db
      .insert(quizRecalls)
      .values({ userId: session.id, textId: id, round: recall.round, score })
      .onConflictDoNothing();

    return NextResponse.json({
      round: recall.round,
      score,
      original: recall.original,
      results: questions.map((question, index) => ({
        prompt: question.prompt,
        choices: question.choices,
        answer: question.answer,
        given: Number.isInteger(answers[index]) ? answers[index] : null,
      })),
    });
  } catch (error) {
    return serverError("texts/recordar/respostas", error);
  }
}

/**
 * Dispensa a rodada vencida sem responder (US-223).
 *
 * Grava a rodada em `quiz_recalls` com a nota nula: ela deixa de ser
 * oferecida, como uma rodada feita, mas nao entra em nenhuma conta de nota.
 * So a rodada de hoje e dispensada: quem dispensa a de 7 dias ainda recebe a
 * de 30. Sem rodada vencida, 404, como no GET e no POST.
 *
 * `?rodada=` diz qual rodada a tela mostrou. Se a vencida agora for outra (a
 * tela ficou aberta na virada do dia 30), nada e gravado e a resposta e 404:
 * a folha prometeu que a de 30 continuaria valendo.
 */
export async function DELETE(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);

    // `loadDueRecall` so acha textos da conta: o dono e conferido ali.
    const recall = await loadDueRecall(session.id, id);
    if (!recall) return jsonError(NOT_DUE, 404);
    const asked = new URL(request.url).searchParams.get("rodada");
    if (asked !== null && Number(asked) !== recall.round) return jsonError(NOT_DUE, 404);

    await db
      .insert(quizRecalls)
      .values({ userId: session.id, textId: id, round: recall.round, score: null })
      // Respondida ou dispensada em outra aba no meio do caminho: fica a primeira.
      .onConflictDoNothing();

    return NextResponse.json({ dismissed: recall.round });
  } catch (error) {
    return serverError("texts/recordar/dispensar", error);
  }
}
