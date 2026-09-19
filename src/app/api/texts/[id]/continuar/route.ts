import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { extractTextFromHtml } from "@/lib/parser";
import { fetchPublicHtml, SafeFetchError } from "@/lib/safe-fetch";
import { alreadyPresent, buildPageUrl } from "@/lib/continuation";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { countWords } from "@/lib/reading";

export const dynamic = "force-dynamic";

const MAX_CONTENT_CHARS = 400_000;
const MIN_WORDS = 10;
const MAX_SOURCE_PAGE = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Busca a continuacao do texto na origem.
 *
 * Muitos contos e artigos longos sao servidos em partes na mesma URL, mudando
 * apenas `?page=`. A importacao inicial e sempre a pagina 1; daqui em diante a
 * proxima parte e a URL original com `page` = ultima trazida + 1. A base e
 * sempre a URL importada, nunca a da ultima busca, para nao acumular
 * parametros a cada chamada.
 *
 * Nenhum desfecho esperado vira erro: "nao ha mais paginas", "a origem nao
 * respondeu" e "veio a mesma pagina de novo" sao resultados normais desta
 * acao e voltam com 200 e um `status` proprio, para a tela apenas informar
 * sem quebrar a leitura. Status fora da faixa 2xx ficam reservados para
 * sessao ausente, texto inexistente e id invalido.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const [text] = await db
      .select()
      .from(texts)
      .where(and(eq(texts.id, id), eq(texts.userId, session.id)))
      .limit(1);

    if (!text) return jsonError("Texto nao encontrado.", 404);

    if (!text.sourceUrl) {
      return NextResponse.json({
        status: "no-source",
        message: "Este texto foi colado manualmente, nao ha origem para buscar.",
      });
    }

    if (text.sourcePage >= MAX_SOURCE_PAGE) {
      return NextResponse.json({
        status: "limit",
        message: "Limite de partes atingido para este texto.",
      });
    }

    if (text.content.length >= MAX_CONTENT_CHARS) {
      return NextResponse.json({
        status: "full",
        message: "Este texto ja atingiu o tamanho maximo.",
      });
    }

    const limit = rateLimit(`continuar:${clientIp(request)}`, 30, 10 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json({
        status: "unavailable",
        message: "Muitas buscas seguidas. Aguarde um pouco.",
        retryAfter: limit.retryAfterSeconds,
      });
    }

    const nextPage = text.sourcePage + 1;
    const target = buildPageUrl(text.sourceUrl, nextPage);
    if (!target) {
      return NextResponse.json({
        status: "no-source",
        message: "A origem deste texto nao e um endereco valido.",
      });
    }

    let html: string;
    try {
      ({ html } = await fetchPublicHtml(target));
    } catch (error) {
      return NextResponse.json(endOrUnavailable(error, nextPage));
    }

    let parsed;
    try {
      parsed = extractTextFromHtml(html);
    } catch (error) {
      console.error("[texts/continuar] falha ao interpretar o HTML:", error);
      return NextResponse.json({
        status: "unavailable",
        page: nextPage,
        message: "Nao consegui interpretar a proxima parte.",
      });
    }

    if (parsed.wordCount < MIN_WORDS) {
      return NextResponse.json({
        status: "end",
        page: nextPage,
        message: "Nao ha mais partes neste texto.",
      });
    }

    // Sites que ignoram ?page= devolvem a primeira parte de novo. Sem esta
    // checagem o texto seria duplicado a cada tentativa.
    if (alreadyPresent(text.content, parsed.content)) {
      return NextResponse.json({
        status: "end",
        page: nextPage,
        message: "A origem repetiu a parte anterior: nao ha mais paginas.",
      });
    }

    const merged = `${text.content.trimEnd()}\n\n${parsed.content.trim()}`.slice(
      0,
      MAX_CONTENT_CHARS
    );

    const [updated] = await db
      .update(texts)
      .set({
        content: merged,
        wordCount: countWords(merged),
        sourcePage: nextPage,
        updatedAt: new Date(),
      })
      .where(and(eq(texts.id, id), eq(texts.userId, session.id)))
      .returning();

    return NextResponse.json({
      status: "appended",
      page: nextPage,
      addedWords: (updated?.wordCount ?? 0) - text.wordCount,
      text: updated,
    });
  } catch (error) {
    return serverError("texts/continuar", error);
  }
}

/**
 * 404 e 410 na proxima parte significam que o conto acabou, nao que algo
 * deu errado. Qualquer outra falha e indisponibilidade temporaria.
 */
function endOrUnavailable(error: unknown, page: number) {
  if (error instanceof SafeFetchError) {
    if (error.status === 404 || error.status === 410) {
      return { status: "end", page, message: "Nao ha mais partes neste texto." };
    }
    return { status: "unavailable", page, message: error.message };
  }

  if (error instanceof Error && error.name === "TimeoutError") {
    return { status: "unavailable", page, message: "A origem demorou demais para responder." };
  }

  console.error("[texts/continuar] falha inesperada na busca:", error);
  return { status: "unavailable", page, message: "Nao consegui buscar a proxima parte." };
}
