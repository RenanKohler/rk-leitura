import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { ImportError, importFromUrl } from "@/lib/import-text";
import { findTextBySourceUrl, loadNextUp } from "@/lib/queries";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { countWords } from "@/lib/reading";
import { detectSeries } from "@/lib/series";
import { normalizeSourceUrl, pageFromUrl } from "@/lib/source-url";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Busca o proximo capitulo da serie na origem e o salva.
 *
 * Existe separado da continuacao (US-23) porque sao dois movimentos
 * diferentes: a continuacao anexa mais paginas ao mesmo capitulo, esta cria o
 * capitulo seguinte como texto proprio.
 *
 * Nunca devolve erro por nao haver proximo capitulo: fim de serie e uma
 * resposta valida, e a tela de conclusao nao pode quebrar por causa dela.
 */
export async function POST(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`capitulo:${clientIp(request)}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas buscas seguidas. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const [owner, next] = await Promise.all([
      seriesOf(session.id, id),
      loadNextUp(session.id, id),
    ]);

    // "Nao existe" e "nao ha proximo" sao respostas diferentes: a segunda e o
    // fim de serie do criterio 4, e a tela de conclusao segue no lugar.
    if (!owner.found) return jsonError("Texto nao encontrado.", 404);
    if (!next) {
      return NextResponse.json({ status: "end", message: "Nao ha proxima leitura." });
    }

    // Ja esta na biblioteca: nada a importar.
    if (next.textId) {
      return NextResponse.json({ status: "existing", id: next.textId, title: next.title });
    }
    if (!next.importUrl) {
      return NextResponse.json({ status: "end", message: "Esta e a ultima parte da serie." });
    }

    const url = normalizeSourceUrl(next.importUrl);
    const known = await findTextBySourceUrl(session.id, [url]);
    if (known) return NextResponse.json({ status: "existing", id: known.id, title: known.title });

    const imported = await importFromUrl(url);
    const finalUrl = normalizeSourceUrl(imported.sourceUrl);
    const series = detectSeries(imported.title, finalUrl);

    const [created] = await db
      .insert(texts)
      .values({
        userId: session.id,
        title: imported.title.slice(0, 200),
        sourceUrl: finalUrl,
        content: imported.content,
        wordCount: countWords(imported.content),
        sourcePage: pageFromUrl(finalUrl),
        // Quando o capitulo novo nao casa com o padrao, herda a serie do
        // anterior: foi ela que levou ate ele.
        seriesKey: series?.key ?? owner.seriesKey,
        seriesTitle: series?.title ?? owner.seriesTitle,
        chapter: series?.chapter ?? next.chapter ?? null,
      })
      .returning({ id: texts.id, title: texts.title });

    return NextResponse.json({ status: "imported", id: created!.id, title: created!.title }, { status: 201 });
  } catch (error) {
    // A origem nao ter o capitulo seguinte e o caso normal de fim de serie.
    if (error instanceof ImportError) {
      return NextResponse.json({
        status: "end",
        message:
          error.status === 404
            ? "Esta e a ultima parte da serie."
            : "Nao consegui buscar a proxima parte agora.",
      });
    }
    return serverError("texts/proximo", error);
  }
}

/** Confirma que o texto e desta conta e devolve a serie a que ele pertence. */
async function seriesOf(
  userId: string,
  textId: string
): Promise<{ found: boolean; seriesKey: string | null; seriesTitle: string | null }> {
  const [row] = await db
    .select({ seriesKey: texts.seriesKey, seriesTitle: texts.seriesTitle })
    .from(texts)
    .where(and(eq(texts.id, textId), eq(texts.userId, userId)))
    .limit(1);

  return {
    found: Boolean(row),
    seriesKey: row?.seriesKey ?? null,
    seriesTitle: row?.seriesTitle ?? null,
  };
}
