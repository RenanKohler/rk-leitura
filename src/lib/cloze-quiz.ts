import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { readingSessions } from "@/db/schema";
import { loadText } from "@/lib/queries";
import { parseParagraphs } from "@/lib/reading";
import { contentKey, type QuizQuestion } from "@/lib/quiz";
import { buildCloze, MIN_CLOZE_QUESTIONS, passageRange } from "@/lib/cloze";

/**
 * Lacunas de um texto, montadas e corrigidas no servidor (PROD-3).
 *
 * As duas rotas - pedir e responder - chamam esta mesma funcao: a correcao
 * remonta as perguntas com a mesma semente em vez de guardar um gabarito.
 * O trecho vai e volta pela tela (`from`, `to`) para que uma sessao gravada
 * entre as duas chamadas nao troque as perguntas debaixo do leitor.
 */
export type ClozeResult =
  | { status: "ok"; questions: QuizQuestion[]; from: number; to: number }
  | { status: "not-found" }
  | { status: "too-short" };

export async function loadCloze(
  userId: string,
  textId: string,
  range?: { from: number; to: number } | null
): Promise<ClozeResult> {
  const text = await loadText(userId, textId);
  if (!text) return { status: "not-found" };

  const { words } = parseParagraphs(text.content, text.format);
  let span: { from: number; to: number };
  if (range && valid(range, words.length)) {
    span = range;
  } else {
    const [latest] = await db
      .select({ wordsRead: readingSessions.wordsRead })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), eq(readingSessions.textId, textId)))
      .orderBy(desc(readingSessions.createdAt))
      .limit(1);
    span = passageRange(words.length, text.progressIndex, latest?.wordsRead ?? null);
  }

  const questions = buildCloze(words.slice(span.from, span.to), {
    seed: `${textId}:${contentKey(text.content)}:${span.from}:${span.to}`,
  });
  if (questions.length < MIN_CLOZE_QUESTIONS) return { status: "too-short" };
  return { status: "ok", questions, ...span };
}

function valid(range: { from: number; to: number }, total: number): boolean {
  return (
    Number.isInteger(range.from) &&
    Number.isInteger(range.to) &&
    range.from >= 0 &&
    range.to > range.from &&
    range.to <= total
  );
}

/**
 * Anota a nota na sessao mais recente do texto, como o questionario faz.
 *
 * E por ela que a compreensao chega ao treino: o dia do programa aponta para
 * a sessao, e `earnedSteps` le a nota dali.
 */
export async function recordComprehension(userId: string, textId: string, score: number) {
  const [latest] = await db
    .select({ id: readingSessions.id })
    .from(readingSessions)
    .where(and(eq(readingSessions.userId, userId), eq(readingSessions.textId, textId)))
    .orderBy(desc(readingSessions.createdAt))
    .limit(1);

  if (latest) {
    await db
      .update(readingSessions)
      .set({ comprehension: score })
      .where(eq(readingSessions.id, latest.id));
  }
}
