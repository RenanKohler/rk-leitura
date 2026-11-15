import { NextResponse } from "next/server";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { aiErrorResponse, AiUnavailable } from "@/lib/ai";
import { settleFailedCall, type ChargedCall } from "@/lib/ai-refund";
import { loadAiResult, saveAiResult } from "@/lib/ai-results";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { loadStudyText, studyGate } from "@/lib/study-tools";
import {
  characteristicTerms,
  charsPerCandidate,
  linksKey,
  linksMessage,
  NO_CANDIDATES,
  NO_LINKS,
  parseStoredLinks,
  pickParagraphs,
  rankCandidates,
  SAMPLE_CHARS,
  validLinks,
  type SourceText,
} from "@/lib/text-links";
import { generateLinks, LINKS_MESSAGES } from "@/lib/text-links-ai";
import { libraryHits, loadCandidates, seriesOf } from "@/lib/text-links-queries";

export const dynamic = "force-dynamic";
// Amostra deste texto e ate 24 mil caracteres dos outros, no Sonnet.
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/**
 * Ligacoes com outros textos (US-232): trechos de outros textos da conta que
 * tratam do mesmo assunto, complementam ou contradizem este. Os candidatos
 * saem por termos em comum (sem embeddings: "busca por significado" esta no
 * Won't Have); sem candidato, o modelo nao e chamado. Cada ligacao traz as
 * duas citacoes conferidas literalmente. O resultado fica guardado por uma
 * chave que muda com este texto e com os candidatos.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`ligacoes:${clientIp(request)}`, 20, 60 * 60 * 1000);
  if (!limit.allowed) return jsonError("Muitos pedidos seguidos. Aguarde um pouco.", 429);

  let charged: ChargedCall | null = null;
  try {
    const { id } = await params;
    const text = await loadStudyText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const terms = characteristicTerms(text.words);
    const candidates = rankCandidates(await libraryHits(session.id, id, terms), terms);
    if (candidates.length === 0) {
      return NextResponse.json({ links: [], message: NO_CANDIDATES, cached: false });
    }

    const key = linksKey(id, text.fingerprint, candidates);
    const known = parseStoredLinks(await loadAiResult<unknown>(session.id, "ligacoes", key));
    if (known) {
      return NextResponse.json({
        links: known.links,
        message: known.links.length === 0 ? NO_LINKS : null,
        cached: true,
      });
    }

    // Amostra deste texto: os paragrafos com mais termos caracteristicos.
    const here: SourceText = {
      id,
      title: text.title,
      words: text.words,
      blocks: pickParagraphs(
        text.paragraphs,
        terms.map((term) => term.term),
        SAMPLE_CHARS
      ),
    };

    const series = await seriesOf(session.id, id);
    const contents = new Map((await loadCandidates(session.id, candidates.map((c) => c.id))).map((c) => [c.id, c]));
    const budget = charsPerCandidate(candidates.length);
    const others: SourceText[] = [];
    for (const candidate of candidates) {
      const content = contents.get(candidate.id);
      if (!content) continue;
      const blocks = pickParagraphs(content.paragraphs, candidate.shared, budget);
      if (blocks.length === 0) continue;
      others.push({
        id: candidate.id,
        title: candidate.title,
        words: content.words,
        blocks,
        sameSeries: series !== null && candidate.seriesKey === series,
        chapter: candidate.chapter,
      });
    }
    if (here.blocks.length === 0 || others.length === 0) {
      return NextResponse.json({ links: [], message: NO_CANDIDATES, cached: false });
    }

    const blocked = await studyGate(session.id, LINKS_MESSAGES);
    if (blocked) return blocked;
    charged = { userId: session.id, task: "ligacoes", quota: "estudo" };

    const raw = await generateLinks(session.id, id, linksMessage(here, others), text.language);
    const links = validLinks(raw, here, others);
    const proposed = Array.isArray((raw as { links?: unknown } | null)?.links)
      ? (raw as { links: unknown[] }).links.length
      : 0;
    // O modelo propos ligacoes e nenhuma passou na conferencia: falha, com a cota devolvida.
    if (links.length === 0 && proposed > 0) throw AiUnavailable.invalid(LINKS_MESSAGES.failure);

    await saveAiResult(session.id, id, "ligacoes", key, { links });
    return NextResponse.json({
      links,
      message: links.length === 0 ? NO_LINKS : null,
      cached: false,
      candidates: others.length,
    });
  } catch (error) {
    if (charged) await settleFailedCall(error, charged);
    if (error instanceof AiUnavailable) return aiErrorResponse(error);
    return serverError("texts/ligacoes", error);
  }
}
