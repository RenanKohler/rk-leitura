import { NextResponse } from "next/server";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, AiUnavailable } from "@/lib/ai";
import { loadAiResult, saveAiResult } from "@/lib/ai-results";
import { excerptOf } from "@/lib/ai-text";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { generateNotes, NOTES_MESSAGES } from "@/lib/study-ai";
import { isConcluded } from "@/lib/study-cards";
import {
  notesCount,
  notesKey,
  NOTES_NOT_CONCLUDED,
  parseStoredNotes,
  validNotes,
} from "@/lib/study-notes";
import { keysOf, loadStudyText, studyGate } from "@/lib/study-tools";

export const dynamic = "force-dynamic";
// O texto inteiro no Sonnet: pode passar de um minuto.
export const maxDuration = 150;

type Params = { params: Promise<{ id: string }> };

/**
 * Fichamento de um texto concluido (US-165). Texto nao concluido nao envia
 * nada. Cada item vem com uma citacao conferida literalmente no texto; o
 * resultado fica guardado pela impressao do conteudo.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`fichamento:${clientIp(request)}`, 20, 60 * 60 * 1000);
  if (!limit.allowed) return jsonError("Muitos pedidos seguidos. Aguarde um pouco.", 429);

  try {
    const { id } = await params;
    const text = await loadStudyText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const total = text.words.length;
    if (!isConcluded({ progressIndex: text.progressIndex, wordCount: total })) {
      return jsonError(NOTES_NOT_CONCLUDED, 400);
    }

    const key = notesKey(id, text.fingerprint);
    const known = parseStoredNotes(await loadAiResult<unknown>(session.id, "fichamento", key));
    if (known && notesCount(known) > 0) {
      return NextResponse.json({ notes: known, sourceUrl: text.sourceUrl, cached: true });
    }

    const blocked = await studyGate(session.id, NOTES_MESSAGES);
    if (blocked) return blocked;

    const excerpt = excerptOf(text.paragraphs, 0, total);
    const raw = await generateNotes(session.id, id, text.title, excerpt.text, text.language);
    const notes = validNotes(raw, text.words, keysOf(text), excerpt.startWord, excerpt.endWord);
    if (notesCount(notes) === 0) return jsonError(NOTES_MESSAGES.failure, 503);

    await saveAiResult(session.id, id, "fichamento", key, notes);
    return NextResponse.json({
      notes,
      sourceUrl: text.sourceUrl,
      cached: false,
      recentOnly: excerpt.truncated,
    });
  } catch (error) {
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/fichamento", error);
  }
}
