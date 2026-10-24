import { NextResponse } from "next/server";
import { db } from "@/db";
import { studyCards } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { todayIn } from "@/lib/goals";
import { loadSettings } from "@/lib/queries";
import {
  dedupeByFront,
  DUPLICATE_FRONT,
  manualCard,
  parseDraftEdits,
  relocateDrafts,
  storedFrontKey,
} from "@/lib/study-card-drafts";
import { parseParagraphs } from "@/lib/reading";
import {
  loadExportCards,
  loadFrontKeys,
  loadPretestCards,
  loadStudyText,
  loadVisibleCards,
} from "@/lib/study-card-store";
import { addDays } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Cartoes de estudo de um texto (US-155, US-159, US-170).
 *
 * Sem parametro, so os cartoes de trechos ja lidos, com a contagem dos
 * demais. Com `?previo=1`, so os de trechos nao lidos, para o teste de
 * conhecimento previo - e o unico caminho por onde eles saem.
 */
export async function GET(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    const text = await loadStudyText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    if (new URL(request.url).searchParams.get("previo") === "1") {
      return NextResponse.json({ cards: await loadPretestCards(session.id, text) });
    }

    const [{ cards, unreadCount }, exportableAll] = await Promise.all([
      loadVisibleCards(session.id, text),
      loadExportCards(session.id).then((all) => all.length),
    ]);
    return NextResponse.json({ cards, unreadCount, exportableAll });
  } catch (error) {
    return serverError("texts/cartoes-estudo", error);
  }
}

/**
 * Cartao criado a mao (US-159). Sem trecho de origem (0 a 0), aparece sempre;
 * entra na revisao com vencimento no dia seguinte, no fuso da conta.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    const text = await loadStudyText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const body = await readJson<{ front?: unknown; back?: unknown }>(request);
    const card = manualCard(body?.front, body?.back);
    if ("error" in card) return jsonError(card.error, 400);

    const key = storedFrontKey(card.front);
    if (key && (await loadFrontKeys(session.id, text.id)).has(key)) return jsonError(DUPLICATE_FRONT, 409);

    const timezone = (await loadSettings(session.id))?.timezone ?? "UTC";
    const [saved] = await db
      .insert(studyCards)
      .values({
        userId: session.id,
        textId: text.id,
        front: card.front,
        back: card.back,
        kind: "manual",
        sourceStart: 0,
        sourceEnd: 0,
        nextReviewOn: addDays(todayIn(timezone), 1),
        frontKey: key,
      })
      .onConflictDoNothing()
      .returning({ id: studyCards.id, nextReviewOn: studyCards.nextReviewOn });
    if (!saved) return jsonError(DUPLICATE_FRONT, 409);

    return NextResponse.json(
      {
        card: {
          id: saved!.id,
          front: card.front,
          back: card.back,
          kind: "manual",
          sourceStart: 0,
          sourceEnd: 0,
          nextReviewOn: saved!.nextReviewOn,
          pretest: null,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return serverError("texts/cartoes-estudo/novo", error);
  }
}

/**
 * Salva os cartoes gerados que o leitor manteve (US-155). Os de trechos nao
 * lidos vem junto, sem terem aparecido: passam a aparecer conforme a leitura
 * avanca. Ficam sem data de revisao (`nextReviewOn` nulo): vencem quando o
 * trecho e lido (`isCardDue`).
 */
export async function PUT(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    const text = await loadStudyText(session.id, id);
    if (!text) return jsonError("Texto não encontrado.", 404);

    const body = await readJson<{ cards?: unknown }>(request);
    const parsed = parseDraftEdits(body?.cards, text.wordCount);
    if (!parsed) return jsonError("Envie os cartões com frente e verso.", 400);
    // A posicao enviada vale para o conteudo de quando os cartoes foram
    // gerados; o trecho e procurado no conteudo de agora (US-192).
    const { kept, dropped } = relocateDrafts(parsed, parseParagraphs(text.content, text.format).words);
    // Frente ja salva (outra aba, painel reaberto) ou repetida no lote: sai
    // aqui; a corrida entre duas gravacoes, no indice unico (US-197).
    const { fresh: cards, repeated } = dedupeByFront(kept, await loadFrontKeys(session.id, text.id));
    if (cards.length === 0) return NextResponse.json({ saved: 0, dropped, repeated });

    const inserted = await db
      .insert(studyCards)
      .values(
        cards.map((card) => ({
          userId: session.id,
          textId: text.id,
          front: card.front,
          back: card.back,
          kind: card.kind,
          sourceStart: card.sourceStart,
          sourceEnd: card.sourceEnd,
          nextReviewOn: null,
          frontKey: storedFrontKey(card.front),
        }))
      )
      .onConflictDoNothing()
      .returning({ id: studyCards.id });

    return NextResponse.json({
      saved: inserted.length,
      dropped,
      repeated: repeated + cards.length - inserted.length,
    });
  } catch (error) {
    return serverError("texts/cartoes-estudo/salvar", error);
  }
}
