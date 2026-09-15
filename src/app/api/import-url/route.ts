import { NextResponse } from "next/server";
import { asString, jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { extractTextFromHtml } from "@/lib/parser";
import { fetchPublicHtml, SafeFetchError } from "@/lib/safe-fetch";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MIN_WORDS = 10;

export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  // A rota faz o servidor buscar uma URL arbitraria: limitar evita usar a
  // aplicacao como proxy de varredura.
  const limit = rateLimit(`import:${clientIp(request)}`, 20, 10 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas importacoes seguidas. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const body = await readJson<{ url?: unknown }>(request);
    const url = asString(body?.url);
    if (!url) return jsonError("Informe a URL do artigo.", 400);

    const { html, finalUrl } = await fetchPublicHtml(url);
    const parsed = extractTextFromHtml(html);

    if (parsed.wordCount < MIN_WORDS) {
      return jsonError("Nao encontrei texto suficiente nessa pagina.", 422);
    }

    return NextResponse.json({
      title: parsed.title,
      content: parsed.content,
      wordCount: parsed.wordCount,
      sourceUrl: finalUrl,
    });
  } catch (error) {
    if (error instanceof SafeFetchError) return jsonError(error.message, 400);
    if (error instanceof Error && error.name === "TimeoutError") {
      return jsonError("A pagina demorou demais para responder.", 504);
    }
    return serverError("import-url", error);
  }
}
