import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { asString, jsonError, readJson, readPageParams, requireSession, serverError } from "@/lib/api";
import { asLanguage } from "@/lib/language";
import { loadLibrary } from "@/lib/queries";
import { asTextScope, asTextStatus, normalizeQuery } from "@/lib/text-filter";
import { asTextFormat, countWords } from "@/lib/reading";
import { normalizeSourceUrl, pageFromUrl } from "@/lib/source-url";
import { detectSeries, seriesKeyFor } from "@/lib/series";
import { normalizeTagList } from "@/lib/tags";
import { applyTags } from "@/lib/text-tags";

export const dynamic = "force-dynamic";

const MAX_CONTENT_CHARS = 400_000;

interface Body {
  title?: unknown;
  sourceUrl?: unknown;
  content?: unknown;
  tags?: unknown;
  /** Sequencia conhecida de antemao, como na importacao de EPUB. */
  series?: unknown;
  /** Idioma declarado pela origem; sem ele, ou fora da lista, portugues. */
  language?: unknown;
  /** "markdown" para interpretar as marcas; qualquer outro valor e texto simples. */
  format?: unknown;
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
    // que e o comportamento de sempre e nao um erro. Quem ja conhece a
    // sequencia - a importacao de EPUB - manda `series` e nao depende da
    // deteccao, o que permite ao capitulo manter o proprio titulo.
    const format = asTextFormat(body?.format);
    const wordCount = countWords(content, format);
    if (wordCount === 0) {
      return jsonError("O texto nao tem palavras para ler.", 400);
    }

    const declared = asDeclaredSeries(body?.series);
    const series = declared ?? detectSeries(title, sourceUrl);
    const tagNames = normalizeTagList(body?.tags);

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(texts)
        .values({
          userId: session.id,
          title: title.slice(0, 200),
          sourceUrl,
          content,
          format,
          // Calculado no servidor: o cliente nao decide a contagem.
          wordCount,
          sourcePage: pageFromUrl(sourceUrl),
          seriesKey: series?.key ?? null,
          seriesTitle: series?.title ?? null,
          chapter: series?.chapter ?? null,
          language: asLanguage(body?.language),
        })
        .returning();

      if (row && tagNames.length > 0) await applyTags(tx, session.id, row.id, tagNames);
      return row;
    });

    return NextResponse.json({ text: created }, { status: 201 });
  } catch (error) {
    return serverError("texts/create", error);
  }
}

/** Serie informada pelo cliente: o titulo do livro e a posicao do capitulo. */
function asDeclaredSeries(
  raw: unknown
): { key: string; chapter: number; title: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const title = asString((raw as { title?: unknown }).title);
  const chapter = Math.trunc(Number((raw as { chapter?: unknown }).chapter));

  if (!title || !Number.isInteger(chapter) || chapter < 1 || chapter > 999) return null;
  return { key: seriesKeyFor(title), chapter, title: title.slice(0, 200) };
}
