import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { asString, jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { countWords } from "@/lib/reading";

export const dynamic = "force-dynamic";

const MAX_CONTENT_CHARS = 400_000;

interface Body {
  title?: unknown;
  sourceUrl?: unknown;
  content?: unknown;
}

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const result = await db
      .select({
        id: texts.id,
        title: texts.title,
        sourceUrl: texts.sourceUrl,
        wordCount: texts.wordCount,
        progressIndex: texts.progressIndex,
        createdAt: texts.createdAt,
        updatedAt: texts.updatedAt,
      })
      // Lista sem o campo content: uma biblioteca com 50 artigos traria
      // megabytes de texto que a tela nao usa.
      .from(texts)
      .where(eq(texts.userId, session.id))
      .orderBy(desc(texts.createdAt));

    return NextResponse.json({ texts: result });
  } catch (error) {
    return serverError("texts/list", error);
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<Body>(request);
    const title = asString(body?.title);
    const content = asString(body?.content);
    const sourceUrl = asString(body?.sourceUrl);

    if (!title || !content) {
      return jsonError("Titulo e conteudo sao obrigatorios.", 400);
    }
    if (content.length > MAX_CONTENT_CHARS) {
      return jsonError("O texto e grande demais.", 413);
    }

    const [created] = await db
      .insert(texts)
      .values({
        userId: session.id,
        title: title.slice(0, 200),
        sourceUrl,
        content,
        // Calculado no servidor: o cliente nao decide a contagem.
        wordCount: countWords(content),
      })
      .returning();

    return NextResponse.json({ text: created }, { status: 201 });
  } catch (error) {
    return serverError("texts/create", error);
  }
}
