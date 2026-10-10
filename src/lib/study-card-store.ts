import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { studyCards, texts } from "@/db/schema";
import type { AnkiCard } from "@/lib/anki";
import { asTextFormat, type TextFormat } from "@/lib/reading";
import { isCardRead, splitByReading } from "@/lib/study-cards";

/**
 * Leitura dos cartoes de estudo no banco (US-155 a US-170). Toda lista que
 * sai daqui ja passa pela regra de exibicao: cartao de trecho nao lido so
 * sai em `loadPretestCards`, para o teste de conhecimento previo.
 */

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O cartao como a tela recebe. */
export interface StudyCardView {
  id: string;
  front: string;
  back: string;
  kind: string;
  sourceStart: number;
  sourceEnd: number;
  nextReviewOn: string | null;
  pretest: string | null;
}

export interface StudyText {
  id: string;
  title: string;
  content: string;
  format: TextFormat;
  language: string;
  wordCount: number;
  progressIndex: number;
}

export async function loadStudyText(userId: string, textId: string): Promise<StudyText | null> {
  if (!UUID_PATTERN.test(textId)) return null;
  const [row] = await db
    .select({
      id: texts.id,
      title: texts.title,
      content: texts.content,
      format: texts.format,
      language: texts.language,
      wordCount: texts.wordCount,
      progressIndex: texts.progressIndex,
    })
    .from(texts)
    .where(and(eq(texts.id, textId), eq(texts.userId, userId)))
    .limit(1);
  return row ? { ...row, format: asTextFormat(row.format) } : null;
}

const VIEW = {
  id: studyCards.id,
  front: studyCards.front,
  back: studyCards.back,
  kind: studyCards.kind,
  sourceStart: studyCards.sourceStart,
  sourceEnd: studyCards.sourceEnd,
  nextReviewOn: studyCards.nextReviewOn,
  pretest: studyCards.pretest,
};

/** Todos os cartoes do texto, na ordem do texto. Uso interno: nao filtra. */
async function allCards(userId: string, textId: string): Promise<StudyCardView[]> {
  return db
    .select(VIEW)
    .from(studyCards)
    .where(and(eq(studyCards.userId, userId), eq(studyCards.textId, textId)))
    .orderBy(asc(studyCards.sourceStart), asc(studyCards.createdAt));
}

/** Cartoes que a tela pode mostrar e quantos ficam para o teste previo. */
export async function loadVisibleCards(
  userId: string,
  text: StudyText
): Promise<{ cards: StudyCardView[]; unreadCount: number }> {
  const { read, unread } = splitByReading(await allCards(userId, text.id), text);
  return { cards: read, unreadCount: unread.length };
}

/** So os cartoes de trechos ainda nao lidos (US-170). */
export async function loadPretestCards(userId: string, text: StudyText): Promise<StudyCardView[]> {
  return splitByReading(await allCards(userId, text.id), text).unread;
}

/** Frentes ja salvas do texto, lidas ou nao: a geracao nova nao as repete. */
export async function loadFronts(userId: string, textId: string): Promise<string[]> {
  const rows = await db
    .select({ front: studyCards.front })
    .from(studyCards)
    .where(and(eq(studyCards.userId, userId), eq(studyCards.textId, textId)))
    .orderBy(asc(studyCards.createdAt));
  return rows.map((row) => row.front);
}

/**
 * Cartoes para o Anki (US-160): de um texto ou da conta inteira, so os de
 * trechos ja lidos, como na tela.
 */
export async function loadExportCards(userId: string, textId?: string): Promise<AnkiCard[]> {
  const rows = await db
    .select({
      front: studyCards.front,
      back: studyCards.back,
      sourceEnd: studyCards.sourceEnd,
      title: texts.title,
      progressIndex: texts.progressIndex,
      wordCount: texts.wordCount,
    })
    .from(studyCards)
    .innerJoin(texts, eq(texts.id, studyCards.textId))
    .where(
      textId
        ? and(eq(studyCards.userId, userId), eq(studyCards.textId, textId))
        : eq(studyCards.userId, userId)
    )
    .orderBy(asc(texts.title), asc(studyCards.sourceStart), asc(studyCards.createdAt));
  return rows
    .filter((row) => isCardRead(row, row))
    .map((row) => ({ front: row.front, back: row.back, title: row.title }));
}

/** Um cartao da conta, com o progresso do texto dele. */
export async function loadOwnedCard(userId: string, cardId: string) {
  if (!UUID_PATTERN.test(cardId)) return null;
  const [row] = await db
    .select({
      id: studyCards.id,
      kind: studyCards.kind,
      sourceEnd: studyCards.sourceEnd,
      progressIndex: texts.progressIndex,
      wordCount: texts.wordCount,
    })
    .from(studyCards)
    .innerJoin(texts, eq(texts.id, studyCards.textId))
    .where(and(eq(studyCards.id, cardId), eq(studyCards.userId, userId)))
    .limit(1);
  return row ?? null;
}
