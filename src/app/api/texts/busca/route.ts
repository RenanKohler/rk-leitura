import { NextResponse } from "next/server";
import { requireSession, serverError } from "@/lib/api";
import { normalizeQuery } from "@/lib/text-filter";
import { CONTENT_SEARCH_LIMIT, searchContent } from "@/lib/learning-queries";

export const dynamic = "force-dynamic";

/** Termo curto demais acha todos os textos e nao ajuda a achar nenhum. */
const MIN_CONTENT_QUERY = 3;

/**
 * Busca no conteudo dos textos (APP-16).
 *
 * `GET /api/texts/busca?q=termo` devolve `{ matches: ContentMatch[] }`, no
 * maximo 8, com o trecho da primeira ocorrencia e o indice da palavra para
 * abrir o leitor ali (`/leitor/<id>?de=<wordIndex>`). Separada da listagem
 * porque varre o conteudo inteiro: a biblioteca paginada nao pode esperar por
 * ela a cada troca de pagina.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const query = normalizeQuery(new URL(request.url).searchParams.get("q"));
    if (!query || query.length < MIN_CONTENT_QUERY) {
      return NextResponse.json({ matches: [], limit: CONTENT_SEARCH_LIMIT });
    }
    return NextResponse.json({
      matches: await searchContent(session.id, query),
      limit: CONTENT_SEARCH_LIMIT,
    });
  } catch (error) {
    return serverError("texts/busca", error);
  }
}
