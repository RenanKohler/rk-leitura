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
 *
 * Na checagem de uma sessao (US-149) a tela diz qual sessao foi: a nota vai
 * para ela, e so se ela for deste texto e desta conta. Sem a sessao gravada
 * (o envio falhou), a nota nao vai para outra.
 */
export async function recordComprehension(
  userId: string,
  textId: string,
  score: number,
  sessionId?: string | null
) {
  if (sessionId !== undefined) {
    if (sessionId) await recordSessionScore(userId, textId, sessionId, score);
    return;
  }

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

/** Nota numa sessao conhecida, conferindo a conta e o texto. */
export async function recordSessionScore(
  userId: string,
  textId: string,
  sessionId: string,
  score: number
): Promise<boolean> {
  const updated = await db
    .update(readingSessions)
    .set({ comprehension: score })
    .where(
      and(
        eq(readingSessions.id, sessionId),
        eq(readingSessions.userId, userId),
        eq(readingSessions.textId, textId)
      )
    )
    .returning({ id: readingSessions.id });
  return updated.length > 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sessao informada pela tela: `undefined` quando o campo nao veio (o
 * comportamento de antes, sessao mais recente), null quando veio vazio ou
 * invalido (checagem sem sessao gravada).
 */
export function sessionIdFrom(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" && UUID.test(value) ? value : null;
}
