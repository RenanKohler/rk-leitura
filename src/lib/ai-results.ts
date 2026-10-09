import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiResults } from "@/db/schema";

/**
 * Resultados do modelo guardados por conta, tipo e chave, para que reabrir
 * nao gere uma chamada nova. A chave carrega a impressao do conteudo: quando o
 * texto muda, o resultado antigo simplesmente nao e mais encontrado.
 */

export type AiResultKind =
  | "explicacao"
  | "resumo"
  | "capitulo"
  | "nomes"
  | "sinopse"
  | "sintese"
  | "sugestoes"
  | "secoes"
  | "semana";

export async function loadAiResult<T>(
  userId: string,
  kind: AiResultKind,
  key: string
): Promise<T | null> {
  const [row] = await db
    .select({ payload: aiResults.payload })
    .from(aiResults)
    .where(and(eq(aiResults.userId, userId), eq(aiResults.kind, kind), eq(aiResults.key, key)))
    .limit(1);
  return row ? (row.payload as T) : null;
}

export async function saveAiResult(
  userId: string,
  textId: string | null,
  kind: AiResultKind,
  key: string,
  payload: unknown
): Promise<void> {
  await db
    .insert(aiResults)
    .values({ userId, textId, kind, key, payload })
    .onConflictDoUpdate({
      target: [aiResults.userId, aiResults.kind, aiResults.key],
      set: { payload, createdAt: new Date() },
    });
}

/** Resultados de um tipo para um texto, do mais recente ao mais antigo. */
export async function latestAiResult<T>(
  userId: string,
  textId: string,
  kind: AiResultKind
): Promise<{ key: string; payload: T } | null> {
  const rows = await db
    .select({ key: aiResults.key, payload: aiResults.payload, createdAt: aiResults.createdAt })
    .from(aiResults)
    .where(and(eq(aiResults.userId, userId), eq(aiResults.textId, textId), eq(aiResults.kind, kind)));
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const row = rows[0];
  return row ? { key: row.key, payload: row.payload as T } : null;
}
