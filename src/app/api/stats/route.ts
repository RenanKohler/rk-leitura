import { NextResponse } from "next/server";
import { and, count, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { readingSessions, texts } from "@/db/schema";
import { requireSession, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Agregados do painel, calculados no banco.
 *
 * Antes a tela baixava a lista inteira de sessoes e de textos so para somar no
 * cliente. Alem de desperdicar banda, isso quebraria agora que as listas sao
 * paginadas: as contas passariam a considerar apenas a primeira pagina.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const [[totals], [textTotals], [continueReading]] = await Promise.all([
      db
        .select({
          sessions: count(),
          wordsRead: sql<number>`coalesce(sum(${readingSessions.wordsRead}), 0)`.mapWith(Number),
          avgWpm: sql<number>`coalesce(round(avg(${readingSessions.wpm})), 0)`.mapWith(Number),
          bestWpm: sql<number>`coalesce(max(${readingSessions.wpm}), 0)`.mapWith(Number),
        })
        .from(readingSessions)
        .where(eq(readingSessions.userId, session.id)),

      db
        .select({ texts: count() })
        .from(texts)
        .where(eq(texts.userId, session.id)),

      // Leitura em andamento mais recente: comecada e ainda nao terminada.
      db
        .select({
          id: texts.id,
          title: texts.title,
          wordCount: texts.wordCount,
          progressIndex: texts.progressIndex,
        })
        .from(texts)
        .where(
          and(
            eq(texts.userId, session.id),
            gt(texts.progressIndex, 0),
            lt(texts.progressIndex, texts.wordCount)
          )
        )
        .orderBy(desc(texts.updatedAt))
        .limit(1),
    ]);

    return NextResponse.json({
      stats: {
        texts: textTotals?.texts ?? 0,
        sessions: totals?.sessions ?? 0,
        wordsRead: totals?.wordsRead ?? 0,
        avgWpm: totals?.avgWpm ?? 0,
        bestWpm: totals?.bestWpm ?? 0,
      },
      continueReading: continueReading ?? null,
    });
  } catch (error) {
    return serverError("stats", error);
  }
}
