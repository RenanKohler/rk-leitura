import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { asString, jsonError, readJson, readPageParams, requireSession, serverError } from "@/lib/api";
import { loadTexts } from "@/lib/queries";
import { countWords } from "@/lib/reading";

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
    const { items, ...page } = await loadTexts(session.id, params.page, params.limit);
    return NextResponse.json({ texts: items, ...page });
  } catch (error) {
    return serverError("texts/list", error);
  }
}

/** Numero da parte que a URL importada representa; 1 quando nao ha `page`. */
function pageFromUrl(sourceUrl: string | null): number {
  if (!sourceUrl) return 1;

  try {
    const page = Number(new URL(sourceUrl).searchParams.get("page"));
    return Number.isInteger(page) && page > 1 ? page : 1;
  } catch {
    return 1;
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
        // Importar uma URL que ja aponta para uma parte ("?page=3") significa
        // que a continuacao deve seguir da 4, nao voltar para a 2 - o que
        // traria de novo o que ja esta salvo.
        sourcePage: pageFromUrl(sourceUrl),
      })
      .returning();

    return NextResponse.json({ text: created }, { status: 201 });
  } catch (error) {
    return serverError("texts/create", error);
  }
}
