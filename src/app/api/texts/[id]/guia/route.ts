import { NextResponse } from "next/server";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, AiUnavailable } from "@/lib/ai";
import { loadAiResult, saveAiResult } from "@/lib/ai-results";
import { excerptOf } from "@/lib/ai-text";
import { guideKey, guideRange, NO_SECTIONS, parseStoredGuide, validGuide } from "@/lib/guide-questions";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { generateGuide, GUIDE_MESSAGES } from "@/lib/study-ai";
import { keysOf, loadStudyText, sectionsOf, studyGate } from "@/lib/study-tools";
import { sectionStartingAt } from "@/lib/text-sections";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

type Params = { params: Promise<{ id: string }> };

/**
 * Perguntas-guia de uma secao (US-166). E a unica rota que envia texto a
 * frente da posicao de leitura: a secao pedida, e so ela, porque o leitor
 * ligou a opcao. Guardadas por secao e impressao do conteudo.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`guia:${clientIp(request)}`, 60, 60 * 60 * 1000);
  if (!limit.allowed) return jsonError("Muitos pedidos seguidos. Aguarde um pouco.", 429);

  try {
    const { id } = await params;
    const text = await loadStudyText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const sections = sectionsOf(text);
    if (sections.length === 0) return jsonError(NO_SECTIONS, 400);
    const body = await readJson<{ section?: unknown; cachedOnly?: unknown }>(request);
    const section = sectionStartingAt(sections, Number(body?.section));
    if (!section) return jsonError("Seção não encontrada.", 404);

    const key = guideKey(id, text.fingerprint, section.start);
    const known = parseStoredGuide(await loadAiResult<unknown>(session.id, "guia", key));
    if (known && known.length > 0) return NextResponse.json({ questions: known, cached: true });
    // As perguntas de uma secao ja lida so voltam se existem: nada e gerado.
    if (body?.cachedOnly === true) return NextResponse.json({ questions: [], cached: false });

    const blocked = await studyGate(session.id, GUIDE_MESSAGES);
    if (blocked) return blocked;

    const range = guideRange(section);
    const excerpt = excerptOf(text.paragraphs, range.from, range.to);
    const raw = await generateGuide(session.id, id, text.title, section.title, excerpt.text, text.language);
    const questions = validGuide(raw, text.words, keysOf(text), {
      from: excerpt.startWord,
      to: excerpt.endWord,
    });
    if (questions.length === 0) return jsonError(GUIDE_MESSAGES.failure, 503);

    await saveAiResult(session.id, id, "guia", key, { questions });
    return NextResponse.json({ questions, cached: false });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/guia", error);
  }
}
