import { NextResponse } from "next/server";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { MAX_PASSAGE_WORDS, PASSAGE_TOO_LONG, passageSpan, passageWords } from "@/lib/passage-card";
import { cardSide, MAX_CARD_SIDE_CHARS } from "@/lib/study-cards";
import { insertStudyCard, loadStudyText } from "@/lib/study-tools";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Grava o cartao de um trecho (US-158), depois de o leitor editar a proposta.
 * O trecho de origem e a selecao: o cartao entra na revisao porque o trecho
 * ja esta na tela de quem leu.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    const text = await loadStudyText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const body = await readJson<{ front?: unknown; back?: unknown; start?: unknown; end?: unknown }>(
      request
    );
    const span = passageSpan(body, text.words.length);
    if (!span) return jsonError("Trecho inválido.", 400);
    if (passageWords(span) > MAX_PASSAGE_WORDS) return jsonError(PASSAGE_TOO_LONG, 400);
    const front = cardSide(body?.front);
    const back = cardSide(body?.back);
    if (!front || !back) {
      return jsonError(`Preencha frente e verso, com até ${MAX_CARD_SIDE_CHARS} caracteres cada.`, 400);
    }

    const card = await insertStudyCard(session.id, id, {
      front,
      back,
      kind: "trecho",
      sourceStart: span.start,
      sourceEnd: span.end,
    });
    return NextResponse.json({ card: { id: card.id, front, back } }, { status: 201 });
  } catch (error) {
    return serverError("texts/cartao/salvar", error);
  }
}
