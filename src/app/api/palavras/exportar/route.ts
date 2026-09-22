import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { savedWords, texts } from "@/db/schema";
import { requireSession, serverError } from "@/lib/api";
import { wordsCsv } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

/** Palavras salvas em CSV, para estudar em outro aplicativo (US-65). */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const rows = await db
      .select({
        word: savedWords.word,
        base: savedWords.base,
        kind: savedWords.kind,
        definition: savedWords.definition,
        translation: savedWords.translation,
        context: savedWords.context,
        textTitle: texts.title,
      })
      .from(savedWords)
      .leftJoin(texts, eq(texts.id, savedWords.textId))
      .where(eq(savedWords.userId, session.id))
      .orderBy(desc(savedWords.createdAt));

    return new NextResponse(wordsCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="palavras-leitura.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return serverError("palavras/exportar", error);
  }
}
