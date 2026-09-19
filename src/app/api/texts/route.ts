import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { asString, jsonError, readJson, readPageParams, requireSession, serverError } from "@/lib/api";
import { loadTexts } from "@/lib/queries";
import { asTextStatus, normalizeQuery } from "@/lib/text-filter";
import { countWords } from "@/lib/reading";
import { normalizeSourceUrl, pageFromUrl } from "@/lib/source-url";

export const dynamic = "force-dynamic";

const MAX_CONTENT_CHARS = 400_000;

interface Body {
  title?: unknown;
  sourceUrl?: unknown;
  content?: unknown;
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const params = readPageParams(request);
    const search = new URL(request.url).searchParams;

    const { items, ...page } = await loadTexts(session.id, params.page, params.limit, {
      query: normalizeQuery(search.get("q")),
      status: asTextStatus(search.get("status")),
    });

    return NextResponse.json({ texts: items, ...page });
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
    const rawSourceUrl = asString(body?.sourceUrl);
    // Forma canonica na escrita: e o que permite reconhecer, depois, que um
    // endereco compartilhado ja esta na biblioteca.
    const sourceUrl = rawSourceUrl ? normalizeSourceUrl(rawSourceUrl) : null;

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
        sourcePage: pageFromUrl(sourceUrl),
      })
      .returning();

    return NextResponse.json({ text: created }, { status: 201 });
  } catch (error) {
    return serverError("texts/create", error);
  }
}
