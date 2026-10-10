import { NextResponse } from "next/server";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, AiUnavailable } from "@/lib/ai";
import { excerptOf } from "@/lib/ai-text";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { generateTeachBack, TEACH_BACK_MESSAGES } from "@/lib/study-ai";
import { keysOf, loadStudyText, sectionsOf, studyGate, type StudyText } from "@/lib/study-tools";
import { checkExplanation, NOTHING_READ, pickPart, readParts, validPoints, wordsRead } from "@/lib/teach-back";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

type Params = { params: Promise<{ id: string }> };

function partsOf(text: StudyText) {
  const read = wordsRead({ progressIndex: text.progressIndex, wordCount: text.words.length });
  return readParts(sectionsOf(text), read);
}

/** Partes ja lidas que o leitor pode escolher (US-167). */
export async function GET(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  try {
    const { id } = await params;
    const text = await loadStudyText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);
    return NextResponse.json({ parts: partsOf(text) });
  } catch (error) {
    return serverError("texts/apontamentos", error);
  }
}

/**
 * "Conferir" (US-167): ate 4 apontamentos sobre a explicacao do leitor, cada
 * um com o trecho que o sustenta. So vai ao modelo a parte escolhida, cortada
 * na posicao de leitura. Nada fica guardado e nada entra nas estatisticas.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`apontamentos:${clientIp(request)}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) return jsonError("Muitos pedidos seguidos. Aguarde um pouco.", 429);

  try {
    const { id } = await params;
    const body = await readJson<{ start?: unknown; explanation?: unknown }>(request);
    const checked = checkExplanation(body?.explanation);
    if ("error" in checked) return jsonError(checked.error, 400);

    const text = await loadStudyText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);
    const parts = partsOf(text);
    if (parts.length === 0) return jsonError(NOTHING_READ, 400);
    const part = pickPart(parts, body?.start);
    if (!part) return jsonError("Escolha uma parte já lida.", 400);

    const blocked = await studyGate(session.id, TEACH_BACK_MESSAGES);
    if (blocked) return blocked;

    const excerpt = excerptOf(text.paragraphs, part.start, part.end);
    const raw = await generateTeachBack(
      session.id,
      id,
      text.title,
      excerpt.text,
      checked.text,
      text.language
    );
    const points = validPoints(raw, text.words, keysOf(text), {
      start: excerpt.startWord,
      end: excerpt.endWord,
    });
    return NextResponse.json({ points });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/apontamentos", error);
  }
}
