import { NextResponse } from "next/server";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { asString, jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { ImportError, importFromUrl } from "@/lib/import-text";
import { findTextBySourceUrl } from "@/lib/queries";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { countWords } from "@/lib/reading";
import { normalizeSourceUrl, pageFromUrl } from "@/lib/source-url";
import { detectSeries } from "@/lib/series";
import type { ShareResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Importa e salva em uma chamada so.
 *
 * Existe por causa do compartilhamento do navegador. Ali cada ida e volta de
 * rede vira espera na tela, e a decisao de reaproveitar um texto ja salvo
 * precisa ser do servidor: o cliente nao tem como saber, antes de buscar a
 * pagina, para onde o endereco redireciona.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  // Mesmo balde de `/api/import-url`: as duas fazem o servidor buscar uma URL
  // arbitraria, entao dividir o limite entre elas nao ajudaria em nada.
  const limit = await rateLimit(`import:${clientIp(request)}`, 20, 10 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas importacoes seguidas. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const body = await readJson<{ url?: unknown }>(request);
    const raw = asString(body?.url);
    if (!raw || !/^https?:\/\//i.test(raw)) {
      return jsonError("O endereco precisa comecar com http:// ou https://", 400);
    }

    const url = normalizeSourceUrl(raw);

    const known = await findTextBySourceUrl(session.id, [url]);
    if (known) return result("existing", known);

    const imported = await importFromUrl(url);
    const finalUrl = normalizeSourceUrl(imported.sourceUrl);

    // Segunda checagem: a origem pode ter redirecionado para um endereco que
    // ja esta na biblioteca com outra grafia.
    const afterRedirect =
      finalUrl === url ? null : await findTextBySourceUrl(session.id, [finalUrl]);
    if (afterRedirect) return result("existing", afterRedirect);

    const [created] = await db
      .insert(texts)
      .values({
        userId: session.id,
        title: imported.title.slice(0, 200),
        sourceUrl: finalUrl,
        content: imported.content,
        wordCount: countWords(imported.content),
        sourcePage: pageFromUrl(finalUrl),
        ...seriesFields(imported.title, finalUrl),
      })
      .returning({ id: texts.id, title: texts.title });

    return result("created", created!, 201);
  } catch (error) {
    if (error instanceof ImportError) return jsonError(error.message, error.status);
    return serverError("share", error);
  }
}

/** Vinculo de serie quando o padrao de capitulo e reconhecido. */
function seriesFields(title: string, sourceUrl: string) {
  const series = detectSeries(title, sourceUrl);
  return {
    seriesKey: series?.key ?? null,
    seriesTitle: series?.title ?? null,
    chapter: series?.chapter ?? null,
  };
}

function result(
  status: ShareResult["status"],
  text: { id: string; title: string },
  httpStatus = 200
) {
  return NextResponse.json<ShareResult>({ status, ...text }, { status: httpStatus });
}
