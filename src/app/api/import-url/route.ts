import { NextResponse } from "next/server";
import { asString, jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { ImportError, importFromUrl } from "@/lib/import-text";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { normalizeSourceUrl } from "@/lib/source-url";

export const dynamic = "force-dynamic";

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

    return NextResponse.json(await importFromUrl(normalizeSourceUrl(url)));
  } catch (error) {
    if (error instanceof ImportError) return jsonError(error.message, error.status);
    return serverError("import-url", error);
  }
}
