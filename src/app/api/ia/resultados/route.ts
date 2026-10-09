import { NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiResults, askTurns } from "@/db/schema";
import { requireSession, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * O que a IA gerou e ficou guardado na conta (US-143): explicacoes, resumos,
 * descricoes de nomes, sinopses, sinteses e demais linhas de `ai_results`,
 * mais as perguntas feitas aos textos (`ask_turns`, US-147).
 *
 * As definicoes salvas em Palavras e as notas criadas a partir de respostas
 * sao do leitor e ficam em outras tabelas: nao entram aqui.
 */

async function storedCount(userId: string): Promise<number> {
  const [[results], [turns]] = await Promise.all([
    db.select({ value: count() }).from(aiResults).where(eq(aiResults.userId, userId)),
    db.select({ value: count() }).from(askTurns).where(eq(askTurns.userId, userId)),
  ]);
  return (results?.value ?? 0) + (turns?.value ?? 0);
}

/** Quantos itens guardados a conta tem; a tela desativa o botao quando e zero. */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    return NextResponse.json({ count: await storedCount(session.id) });
  } catch (error) {
    return serverError("ia/resultados", error);
  }
}

/** Apaga tudo de uma vez; o proximo pedido gera de novo e conta na cota do dia. */
export async function DELETE() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const deleted = await db.transaction(async (tx) => {
      const results = await tx
        .delete(aiResults)
        .where(eq(aiResults.userId, session.id))
        .returning({ id: aiResults.id });
      const turns = await tx
        .delete(askTurns)
        .where(eq(askTurns.userId, session.id))
        .returning({ id: askTurns.id });
      return results.length + turns.length;
    });
    return NextResponse.json({ deleted, count: 0 });
  } catch (error) {
    return serverError("ia/resultados", error);
  }
}
