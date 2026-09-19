import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { asString, jsonError, readJson, readPageParams, requireSession, serverError } from "@/lib/api";
import { loadLibrary } from "@/lib/queries";
import { asTextScope, asTextStatus, normalizeQuery } from "@/lib/text-filter";
import { countWords } from "@/lib/reading";
import { normalizeSourceUrl, pageFromUrl } from "@/lib/source-url";
import { detectSeries } from "@/lib/series";

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

    const { items, texts: count, ...page } = await loadLibrary(session.id, params.page, params.limit, {
      query: normalizeQuery(search.get("q")),
      status: asTextStatus(search.get("status")),
      scope: asTextScope(search.get("scope")),
      tagId: search.get("etiqueta"),
    });

    return NextResponse.json({ items, texts: count, ...page });
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

    // Capitulo reconhecido vira vinculo de serie; nao reconhecido fica solto,
    // que e o comportamento de sempre e nao um erro.
    const series = detectSeries(title, sourceUrl);

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
        seriesKey: series?.key ?? null,
        chapter: series?.chapter ?? null,
      })
      .returning();

    return NextResponse.json({ text: created }, { status: 201 });
  } catch (error) {
    return serverError("texts/create", error);
  }
}
