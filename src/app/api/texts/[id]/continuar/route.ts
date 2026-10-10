import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { MAX_SOURCE_PAGE } from "@/lib/continuation";
import { fetchNextPart } from "@/lib/next-part";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { asTextFormat, countWords } from "@/lib/reading";
import { stripCitations } from "@/lib/citations";

export const dynamic = "force-dynamic";

const MAX_CONTENT_CHARS = 400_000;
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
    if (!UUID_PATTERN.test(id)) return jsonError("Texto não encontrado.", 404);

    const [text] = await db
      .select()
      .from(texts)
      .where(and(eq(texts.id, id), eq(texts.userId, session.id)))
      .limit(1);

    if (!text) return jsonError("Texto não encontrado.", 404);

    if (!text.sourceUrl) {
      return NextResponse.json({
        status: "no-source",
        message: "Este texto foi colado manualmente, não há origem para buscar.",
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
        message: "Este texto já atingiu o tamanho máximo.",
      });
    }

    const limit = await rateLimit(`continuar:${clientIp(request)}`, 30, 10 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json({
        status: "unavailable",
        message: "Muitas buscas seguidas. Aguarde um pouco.",
        retryAfter: limit.retryAfterSeconds,
      });
    }

    const nextPage = text.sourcePage + 1;
    const part = await fetchNextPart(text.sourceUrl, nextPage, text.content);
    if (part.status !== "appended") {
      return NextResponse.json({ status: part.status, page: part.page, message: part.message });
    }
    const parsed = { content: part.content };

    // Texto com referencias omitidas: a parte nova entra do mesmo jeito, e o
    // original guardado recebe a parte completa, para desfazer continuar valendo.
    const omitted = text.originalContent !== null;
    const addition = omitted ? stripCitations(parsed.content).text : parsed.content;
    const merged = `${text.content.trimEnd()}\n\n${addition.trim()}`.slice(0, MAX_CONTENT_CHARS);
    const original = omitted
      ? `${text.originalContent!.trimEnd()}\n\n${parsed.content.trim()}`.slice(0, MAX_CONTENT_CHARS)
      : null;

    const [updated] = await db
      .update(texts)
      .set({
        content: merged,
        ...(omitted ? { originalContent: original } : {}),
        wordCount: countWords(merged, asTextFormat(text.format)),
        sourcePage: nextPage,
        updatedAt: new Date(),
      })
      .where(and(eq(texts.id, id), eq(texts.userId, session.id)))
      .returning();

    return NextResponse.json({
      status: "appended",
      page: nextPage,
      addedWords: (updated?.wordCount ?? 0) - text.wordCount,
      // O original guardado nao vai ao leitor: e so para desfazer, no servidor.
      text: updated ? { ...updated, originalContent: undefined, referencesOmitted: omitted } : updated,
    });
  } catch (error) {
    return serverError("texts/continuar", error);
  }
}
