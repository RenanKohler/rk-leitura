import "server-only";

import { and, eq } from "drizzle-orm";
import type { NextResponse } from "next/server";
import { db } from "@/db";
import { studyCards, texts } from "@/db/schema";
import { aiClient, aiGate, type AiMessages } from "@/lib/ai";
import { jsonError } from "@/lib/api";
import { consumeDailyQuota } from "@/lib/daily-quota";
import { matchKeys } from "@/lib/passage-match";
import { contentKey } from "@/lib/quiz";
import { QUOTA_MESSAGES } from "@/lib/quota";
import { asTextFormat, parseParagraphs, type Paragraph } from "@/lib/reading";
import { navigationHeadings } from "@/lib/sections";
import type { StudyCardKind } from "@/lib/study-cards";
import { sectionRanges, type TextSection } from "@/lib/text-sections";

/**
 * Leitura e gravacao comuns as ferramentas de estudo (US-158, US-164 a
 * US-167): o texto com as duas visoes (palavras e paragrafos), as chaves de
 * comparacao e as secoes, e a gravacao de um cartao.
 */

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StudyText {
  id: string;
  title: string;
  sourceUrl: string | null;
  language: string;
  wordCount: number;
  progressIndex: number;
  /** Impressao do conteudo, para a chave do que fica guardado. */
  fingerprint: string;
  words: string[];
  paragraphs: Paragraph[];
  sections: unknown;
}

export async function loadStudyText(userId: string, id: string): Promise<StudyText | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const [row] = await db
    .select({
      id: texts.id,
      title: texts.title,
      sourceUrl: texts.sourceUrl,
      content: texts.content,
      format: texts.format,
      language: texts.language,
      wordCount: texts.wordCount,
      progressIndex: texts.progressIndex,
      sections: texts.sections,
    })
    .from(texts)
    .where(and(eq(texts.id, id), eq(texts.userId, userId)))
    .limit(1);
  if (!row) return null;
  const { words, paragraphs } = parseParagraphs(row.content, asTextFormat(row.format));
  return {
    id: row.id,
    title: row.title,
    sourceUrl: row.sourceUrl,
    language: row.language,
    // A contagem guardada e a que o resto do app usa; as palavras, a verdade.
    wordCount: words.length,
    progressIndex: row.progressIndex,
    fingerprint: contentKey(row.content),
    words,
    paragraphs,
    sections: row.sections,
  };
}

/** Chaves de comparacao das palavras, para achar termos e citacoes. */
export function keysOf(text: StudyText): string[] {
  return matchKeys(text.words);
}

/** Secoes do sumario como intervalos. */
export function sectionsOf(text: StudyText): TextSection[] {
  return sectionRanges(navigationHeadings(text.paragraphs, text.sections), text.words.length);
}

export interface NewStudyCard {
  front: string;
  back: string;
  kind: StudyCardKind;
  sourceStart: number;
  sourceEnd: number;
}

/**
 * Grava um cartao de estudo. `nextReviewOn` fica nulo: o cartao vence assim
 * que o trecho de origem estiver lido (`isCardDue`), e os desta funcao ja sao
 * de trechos lidos.
 */
export async function insertStudyCard(userId: string, textId: string, card: NewStudyCard) {
  const [row] = await db
    .insert(studyCards)
    .values({
      userId,
      textId,
      front: card.front,
      back: card.back,
      kind: card.kind,
      sourceStart: card.sourceStart,
      sourceEnd: card.sourceEnd,
      nextReviewOn: null,
    })
    .returning({ id: studyCards.id });
  return row!;
}

/**
 * Tudo o que precisa passar antes de uma chamada ao modelo, na ordem das
 * outras funcoes de IA: consentimento (US-125), chave configurada (sem ela o
 * erro sai antes de gastar cota) e a cota `estudo`. Devolve a resposta de
 * recusa pronta, ou null para seguir.
 */
export async function studyGate(userId: string, messages: AiMessages): Promise<NextResponse | null> {
  const gate = await aiGate(userId);
  if (gate) return gate;
  aiClient(messages);
  const quota = await consumeDailyQuota("estudo", userId);
  if (!quota.allowed) {
    return jsonError(QUOTA_MESSAGES.estudo, 429, { retryAfter: quota.retryAfterSeconds });
  }
  return null;
}
