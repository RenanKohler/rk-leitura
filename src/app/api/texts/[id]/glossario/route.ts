import { NextResponse } from "next/server";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, AiUnavailable } from "@/lib/ai";
import { loadAiResult, saveAiResult } from "@/lib/ai-results";
import { excerptOf } from "@/lib/ai-text";
import {
  GLOSSARY_TOO_SOON,
  glossaryCut,
  glossaryKey,
  parseStoredGlossary,
  validGlossary,
} from "@/lib/glossary";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { generateGlossary, GLOSSARY_MESSAGES } from "@/lib/study-ai";
import { keysOf, loadStudyText, studyGate } from "@/lib/study-tools";

export const dynamic = "force-dynamic";
// Trecho longo no Sonnet: pode passar de 30s.
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/**
 * Glossario do trecho lido (US-164).
 *
 * A posicao vem do banco, nao do cliente. O recorte termina no corte da faixa
 * de 1.000 palavras e cada termo precisa aparecer nele; o guardado volta sem
 * chamada nem cota enquanto a leitura nao muda de faixa.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`glossario:${clientIp(request)}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) return jsonError("Muitos pedidos seguidos. Aguarde um pouco.", 429);

  try {
    const { id } = await params;
    const text = await loadStudyText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const cut = glossaryCut({ progressIndex: text.progressIndex, wordCount: text.words.length });
    if (cut === null) return jsonError(GLOSSARY_TOO_SOON, 400);

    const key = glossaryKey(id, text.fingerprint, cut);
    const known = parseStoredGlossary(await loadAiResult<unknown>(session.id, "glossario", key));
    if (known && known.length > 0) return NextResponse.json({ terms: known, cut, cached: true });

    const blocked = await studyGate(session.id, GLOSSARY_MESSAGES);
    if (blocked) return blocked;

    const excerpt = excerptOf(text.paragraphs, 0, cut);
    const raw = await generateGlossary(session.id, id, text.title, excerpt.text, text.language);
    const terms = validGlossary(raw, keysOf(text), { from: excerpt.startWord, to: excerpt.endWord }, cut);
    if (terms.length === 0) return jsonError(GLOSSARY_MESSAGES.failure, 503);

    await saveAiResult(session.id, id, "glossario", key, { terms });
    return NextResponse.json({ terms, cut, cached: false });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/glossario", error);
  }
}
