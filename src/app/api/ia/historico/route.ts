import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, texts } from "@/db/schema";
import { requireSession, serverError } from "@/lib/api";
import { featureLabel, HISTORY_LIMIT, outcomeLabel, textLabel } from "@/lib/ai-history";

export const dynamic = "force-dynamic";

/**
 * Historico de envios (US-144): as ultimas 50 chamadas da conta, com a
 * funcao, o texto de onde saiu o conteudo e quantas palavras foram.
 *
 * O conteudo enviado nao e guardado em lugar nenhum; a lista se monta so a
 * partir de `ai_usage`. O titulo vem do texto atual: excluido o texto, a
 * chave fica nula e a linha diz "Texto excluido".
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const rows = await db
      .select({
        id: aiUsage.id,
        createdAt: aiUsage.createdAt,
        feature: aiUsage.feature,
        outcome: aiUsage.outcome,
        wordsSent: aiUsage.wordsSent,
        textId: aiUsage.textId,
        textTitle: texts.title,
      })
      .from(aiUsage)
      .leftJoin(texts, eq(texts.id, aiUsage.textId))
      .where(eq(aiUsage.userId, session.id))
      .orderBy(desc(aiUsage.createdAt))
      .limit(HISTORY_LIMIT);

    const entries = rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      feature: row.feature,
      featureLabel: featureLabel(row.feature),
      textId: row.textTitle === null ? null : row.textId,
      textLabel: textLabel(row),
      wordsSent: row.wordsSent,
      outcome: row.outcome,
      outcomeLabel: outcomeLabel(row.outcome),
    }));
    return NextResponse.json({ entries });
  } catch (error) {
    return serverError("ia/historico", error);
  }
}
