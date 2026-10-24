import { NextResponse } from "next/server";
import { and, count, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { aiResults, askTurns, comprehensionQuizzes, highlights, studyCards, texts } from "@/db/schema";
import { requireSession, serverError } from "@/lib/api";
import { storedTotal, type StoredAiCounts } from "@/lib/ai-stored";

export const dynamic = "force-dynamic";

/**
 * O que a IA gerou e ficou guardado na conta (US-143): explicacoes, resumos,
 * descricoes de nomes, sinopses, sinteses e demais linhas de `ai_results`,
 * mais as perguntas feitas aos textos (`ask_turns`, US-147).
 *
 * Inclui o que a IA gerou no estudo (US-193): cartoes de estudo gerados e
 * nao editados, analogias, cartoes de destaque e questionarios. Cartao
 * gerado que o leitor editou passa a ser dele e fica.
 *
 * As definicoes salvas em Palavras e as notas criadas a partir de respostas
 * sao do leitor e ficam em outras tabelas: nao entram aqui.
 */

const generatedCard = (userId: string) =>
  and(eq(studyCards.userId, userId), ne(studyCards.kind, "manual"), isNull(studyCards.editedAt));

const editedCard = (userId: string) =>
  and(eq(studyCards.userId, userId), ne(studyCards.kind, "manual"), isNotNull(studyCards.editedAt));

const userTexts = (userId: string) =>
  db.select({ id: texts.id }).from(texts).where(eq(texts.userId, userId));

async function storedCounts(userId: string): Promise<StoredAiCounts> {
  const total = (rows: { value: number }[]) => rows[0]?.value ?? 0;
  const [results, turns, cards, analogies, highlightCards, quizzes, edited] = await Promise.all([
    db.select({ value: count() }).from(aiResults).where(eq(aiResults.userId, userId)),
    db.select({ value: count() }).from(askTurns).where(eq(askTurns.userId, userId)),
    db.select({ value: count() }).from(studyCards).where(generatedCard(userId)),
    db
      .select({ value: count() })
      .from(studyCards)
      .where(and(eq(studyCards.userId, userId), isNotNull(studyCards.analogy))),
    db
      .select({ value: count() })
      .from(highlights)
      .where(and(eq(highlights.userId, userId), isNotNull(highlights.cardPrompt))),
    db
      .select({ value: count() })
      .from(comprehensionQuizzes)
      .where(inArray(comprehensionQuizzes.textId, userTexts(userId))),
    db.select({ value: count() }).from(studyCards).where(editedCard(userId)),
  ]);
  return {
    resultados: total(results),
    perguntas: total(turns),
    cartoes: total(cards),
    analogias: total(analogies),
    cartoesDestaque: total(highlightCards),
    questionarios: total(quizzes),
    cartoesEditados: total(edited),
  };
}

/** Quantos itens guardados a conta tem, por tipo; a tela desativa o botao quando e zero. */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const counts = await storedCounts(session.id);
    return NextResponse.json({ count: storedTotal(counts), counts });
  } catch (error) {
    return serverError("ia/resultados", error);
  }
}

/** Apaga tudo de uma vez; o proximo pedido gera de novo e conta na cota do dia. */
export async function DELETE() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { deleted, kept } = await db.transaction(async (tx) => {
      const results = await tx
        .delete(aiResults)
        .where(eq(aiResults.userId, session.id))
        .returning({ id: aiResults.id });
      const turns = await tx
        .delete(askTurns)
        .where(eq(askTurns.userId, session.id))
        .returning({ id: askTurns.id });
      // Analogias antes dos cartoes: as dos cartoes que ficam tambem saem.
      const analogies = await tx
        .update(studyCards)
        .set({ analogy: null, updatedAt: new Date() })
        .where(and(eq(studyCards.userId, session.id), isNotNull(studyCards.analogy)))
        .returning({ id: studyCards.id });
      const cards = await tx
        .delete(studyCards)
        .where(generatedCard(session.id))
        .returning({ id: studyCards.id });
      const highlightCards = await tx
        .update(highlights)
        .set({ cardPrompt: null, cardAnswer: null })
        .where(and(eq(highlights.userId, session.id), isNotNull(highlights.cardPrompt)))
        .returning({ id: highlights.id });
      const quizzes = await tx
        .delete(comprehensionQuizzes)
        .where(
          inArray(
            comprehensionQuizzes.textId,
            tx.select({ id: texts.id }).from(texts).where(eq(texts.userId, session.id))
          )
        )
        .returning({ id: comprehensionQuizzes.id });
      const [edited] = await tx.select({ value: count() }).from(studyCards).where(editedCard(session.id));
      return {
        deleted:
          results.length +
          turns.length +
          analogies.length +
          cards.length +
          highlightCards.length +
          quizzes.length,
        kept: edited?.value ?? 0,
      };
    });
    return NextResponse.json({ deleted, kept, count: 0 });
  } catch (error) {
    return serverError("ia/resultados", error);
  }
}
