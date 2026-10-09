import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { comprehensionQuizzes } from "@/db/schema";
import { parseQuiz, withEvidencePositions, type Quiz } from "@/lib/quiz";
import { SESSION_CHECK_QUESTIONS, type SessionRange } from "@/lib/session-check";

/**
 * Questionario da checagem de sessao (US-149) no cache dos questionarios:
 * a geracao e a correcao leem pela mesma chave (`sessionQuizKey`).
 */
export async function cachedSessionQuiz(textId: string, key: string): Promise<Quiz | null> {
  const [row] = await db
    .select({ questions: comprehensionQuizzes.questions })
    .from(comprehensionQuizzes)
    .where(
      and(eq(comprehensionQuizzes.textId, textId), eq(comprehensionQuizzes.contentKey, key))
    )
    .limit(1);
  return row ? parseQuiz(row.questions, SESSION_CHECK_QUESTIONS, SESSION_CHECK_QUESTIONS) : null;
}

/**
 * Posicao de cada evidencia (US-134), procurada so dentro do trecho - a
 * mesma frase pode aparecer depois - e devolvida no sistema de indices do
 * texto inteiro.
 */
export function locateInRange(quiz: Quiz, words: string[], range: SessionRange): Quiz {
  const located = withEvidencePositions(quiz, words.slice(range.from, range.to));
  return {
    questions: located.questions.map((question) =>
      question.position
        ? {
            ...question,
            position: {
              start: question.position.start + range.from,
              end: question.position.end + range.from,
            },
          }
        : question
    ),
  };
}
