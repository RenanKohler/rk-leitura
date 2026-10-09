import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { askTurns } from "@/db/schema";
import {
  MAX_STORED_TURNS,
  parseStoredAnswer,
  turnsToDrop,
  type Answer,
  type StoredTurn,
} from "@/lib/ask";

/**
 * Conversa guardada de "Perguntar ao texto" (US-147). Cada pergunta leva a
 * posicao de leitura e a impressao do conteudo (`contentKey`), para a folha
 * avisar quando o texto mudou desde a resposta.
 */

/** Perguntas do texto, da mais antiga a mais nova. */
export async function loadTurns(
  userId: string,
  textId: string,
  fingerprint: string
): Promise<StoredTurn[]> {
  const rows = await db
    .select()
    .from(askTurns)
    .where(and(eq(askTurns.userId, userId), eq(askTurns.textId, textId)))
    .orderBy(asc(askTurns.createdAt));
  const turns: StoredTurn[] = [];
  for (const row of rows) {
    const answer = parseStoredAnswer(row.answer);
    if (!answer) continue;
    turns.push({
      id: row.id,
      question: row.question,
      answer,
      position: row.position,
      stale: row.fingerprint !== fingerprint,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return turns;
}

/** Grava a pergunta e apaga as mais antigas alem do teto. */
export async function saveTurn(
  userId: string,
  textId: string,
  turn: { question: string; answer: Answer; position: number; fingerprint: string }
): Promise<StoredTurn> {
  const [row] = await db
    .insert(askTurns)
    .values({ userId, textId, ...turn })
    .returning({ id: askTurns.id, createdAt: askTurns.createdAt });

  const existing = await db
    .select({ id: askTurns.id, createdAt: askTurns.createdAt })
    .from(askTurns)
    .where(and(eq(askTurns.userId, userId), eq(askTurns.textId, textId)));
  const drop = turnsToDrop(existing, MAX_STORED_TURNS);
  if (drop.length > 0) {
    await db
      .delete(askTurns)
      .where(and(eq(askTurns.userId, userId), inArray(askTurns.id, drop)));
  }

  return {
    id: row!.id,
    question: turn.question,
    answer: turn.answer,
    position: turn.position,
    stale: false,
    createdAt: row!.createdAt.toISOString(),
  };
}

/** "Limpar conversa": apaga as perguntas do texto. */
export async function clearTurns(userId: string, textId: string): Promise<void> {
  await db.delete(askTurns).where(and(eq(askTurns.userId, userId), eq(askTurns.textId, textId)));
}

/** Todas as perguntas da conta, para a exclusao do que a IA gerou (US-143). */
export async function clearAllTurns(userId: string): Promise<void> {
  await db.delete(askTurns).where(eq(askTurns.userId, userId));
}
