import { NextResponse } from "next/server";
import { asString, jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { ImportError, importAllPages, importFromUrl } from "@/lib/import-text";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { normalizeSourceUrl } from "@/lib/source-url";

export const dynamic = "force-dynamic";
// Com todas as paginas, a rota busca varias partes em sequencia.
export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  // A rota faz o servidor buscar uma URL arbitraria: limitar evita usar a
  // aplicacao como proxy de varredura.
  const limit = await rateLimit(`import:${clientIp(request)}`, 20, 10 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas importações seguidas. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const body = await readJson<{ url?: unknown; allPages?: unknown }>(request);
    const url = asString(body?.url);
    if (!url) return jsonError("Informe a URL do artigo.", 400);

    const normalized = normalizeSourceUrl(url);
    // Todas as paginas: a primeira e as seguintes por `?page=`, como faria
    // "Continuar" no leitor, ate a origem acabar.
    if (body?.allPages === true) {
      // Cada pagina e uma busca a mais na origem: a importacao completa conta
      // tambem no limite da continuacao.
      const more = await rateLimit(`continuar:${clientIp(request)}`, 30, 10 * 60 * 1000);
      if (!more.allowed) {
        return jsonError("Muitas buscas seguidas. Aguarde um pouco.", 429, {
          retryAfter: more.retryAfterSeconds,
        });
      }
      return NextResponse.json(await importAllPages(normalized));
    }
    return NextResponse.json(await importFromUrl(normalized));
  } catch (error) {
    if (error instanceof ImportError) return jsonError(error.message, error.status);
    return serverError("import-url", error);
  }
}
