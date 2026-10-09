import { NextResponse } from "next/server";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { loadCloze, recordComprehension, sessionIdFrom } from "@/lib/cloze-quiz";
import { scoreQuiz } from "@/lib/quiz";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Corrige as lacunas remontando as mesmas perguntas (mesmo trecho, mesma
 * semente) e grava a nota na sessao mais recente, como o questionario. Na
 * checagem de uma sessao (US-149) a nota vai para a sessao informada.
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

    const range =
      typeof body?.from === "number" && typeof body?.to === "number"
        ? { from: body.from, to: body.to }
        : null;
    const result = await loadCloze(session.id, id, range);
    if (result.status === "not-found") return jsonError("Texto não encontrado.", 404);
    if (result.status === "too-short") return jsonError("Peça as lacunas antes de responder.", 409);

    const score = scoreQuiz({ questions: result.questions }, answers);
    await recordComprehension(session.id, id, score, sessionIdFrom(body?.sessionId));

    return NextResponse.json({
      score,
      results: result.questions.map((question, index) => ({
        prompt: question.prompt,
        choices: question.choices,
        answer: question.answer,
        given: Number.isInteger(answers[index]) ? answers[index] : null,
        evidence: question.evidence,
      })),
    });
  } catch (error) {
    return serverError("texts/lacunas/respostas", error);
  }
}
