import { NextResponse } from "next/server";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { loadCloze } from "@/lib/cloze-quiz";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Perguntas de lacuna do trecho lido (PROD-3), sem modelo de linguagem.
 *
 * E o que a folha de compreensao oferece quando o questionario por IA nao
 * esta disponivel. Como no questionario, o gabarito nao sai daqui.
 *
 * Na checagem de uma sessao (US-149) a tela manda o trecho da sessao
 * (`from`, `to`), e as lacunas saem dele em vez do trecho da ultima sessao.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);

    const body = await readJson<{ from?: unknown; to?: unknown }>(request);
    const range =
      typeof body?.from === "number" && typeof body?.to === "number"
        ? { from: body.from, to: body.to }
        : null;
    const result = await loadCloze(session.id, id, range);
    if (result.status === "not-found") return jsonError("Texto não encontrado.", 404);
    if (result.status === "too-short") {
      return jsonError("O trecho lido não tem frases suficientes para as lacunas.", 422);
    }

    return NextResponse.json({
      quiz: {
        questions: result.questions.map((question) => ({
          prompt: question.prompt,
          choices: question.choices,
        })),
      },
      questions: result.questions.length,
      from: result.from,
      to: result.to,
    });
  } catch (error) {
    return serverError("texts/lacunas", error);
  }
}
