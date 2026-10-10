import { NextResponse } from "next/server";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { MAX_TERM_WORDS } from "@/lib/glossary";
import { findPhrase, phraseKeys } from "@/lib/passage-match";
import { cardSide } from "@/lib/study-cards";
import { insertStudyCard, keysOf, loadStudyText } from "@/lib/study-tools";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * "Virar cartao" de um termo do glossario (US-164): termo na frente,
 * definicao no verso, origem na primeira ocorrencia. Nao chama o modelo: o
 * que vem do cliente e o que o glossario ja mostrou, e a posicao e conferida
 * contra o texto.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    const text = await loadStudyText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const body = await readJson<{ term?: unknown; definition?: unknown; start?: unknown; end?: unknown }>(
      request
    );
    const term = cardSide(body?.term);
    const definition = cardSide(body?.definition);
    const start = Number(body?.start);
    const end = Number(body?.end);
    if (!term || !definition || phraseKeys(term).length > MAX_TERM_WORDS) {
      return jsonError("Termo inválido.", 400);
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
      return jsonError("Posição inválida.", 400);
    }
    // O termo precisa estar exatamente na posicao informada.
    const found = findPhrase(keysOf(text), term, start, end);
    if (!found || found.start !== start || found.end !== end) {
      return jsonError("O termo não está mais nessa posição do texto.", 409);
    }

    const card = await insertStudyCard(session.id, id, {
      front: term,
      back: definition,
      kind: "glossario",
      sourceStart: start,
      sourceEnd: end,
    });
    return NextResponse.json({ card: { id: card.id } }, { status: 201 });
  } catch (error) {
    return serverError("texts/glossario/cartao", error);
  }
}
