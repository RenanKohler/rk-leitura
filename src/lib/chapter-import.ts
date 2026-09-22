import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { ImportError, importFromUrl } from "@/lib/import-text";
import { asLanguage } from "@/lib/language";
import { findTextBySourceUrl, loadNextUp } from "@/lib/queries";
import { countWords } from "@/lib/reading";
import { detectSeries } from "@/lib/series";
import { normalizeSourceUrl, pageFromUrl } from "@/lib/source-url";

/**
 * Importa o capitulo seguinte ao texto informado.
 *
 * Compartilhado entre o botao da tela de conclusao (US-37) e o acompanhamento
 * periodico (US-70). Os desfechos esperados nao sao erro:
 *
 * - `existing`: o capitulo seguinte ja esta na biblioteca.
 * - `end`: nao ha proximo - fim de serie, ou a origem respondeu 404 (ainda
 *   nao publicado).
 * - `unavailable`: a origem nao respondeu direito; tentar de novo depois.
 */
export type ChapterImport =
  | { status: "missing" }
  | { status: "imported" | "existing"; id: string; title: string; chapter?: number }
  | { status: "end"; message: string }
  | { status: "unavailable"; message: string };

export async function importNextChapter(
  userId: string,
  textId: string,
  { automatic = false }: { automatic?: boolean } = {}
): Promise<ChapterImport> {
  const [[owner], next] = await Promise.all([
    db
      .select({
        seriesKey: texts.seriesKey,
        seriesTitle: texts.seriesTitle,
        language: texts.language,
      })
      .from(texts)
      .where(and(eq(texts.id, textId), eq(texts.userId, userId)))
      .limit(1),
    loadNextUp(userId, textId),
  ]);

  if (!owner) return { status: "missing" };
  if (!next) return { status: "end", message: "Nao ha proxima leitura." };
  if (next.textId) {
    return { status: "existing", id: next.textId, title: next.title ?? "", chapter: next.chapter };
  }
  if (!next.importUrl) return { status: "end", message: "Esta e a ultima parte da serie." };

  const url = normalizeSourceUrl(next.importUrl);
  const known = await findTextBySourceUrl(userId, [url]);
  if (known) return { status: "existing", id: known.id, title: known.title };

  try {
    const imported = await importFromUrl(url);
    const finalUrl = normalizeSourceUrl(imported.sourceUrl);
    const series = detectSeries(imported.title, finalUrl);

    const [created] = await db
      .insert(texts)
      .values({
        userId,
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
        // A pagina do capitulo pode nao declarar idioma; o da serie vale.
        language: imported.language ?? asLanguage(owner.language),
        autoImportedAt: automatic ? new Date() : null,
      })
      .returning({ id: texts.id, title: texts.title, chapter: texts.chapter });

    return {
      status: "imported",
      id: created!.id,
      title: created!.title,
      chapter: created!.chapter ?? undefined,
    };
  } catch (error) {
    // A origem nao ter o capitulo seguinte e o caso normal de fim de serie.
    if (error instanceof ImportError) {
      return error.status === 404
        ? { status: "end", message: "Esta e a ultima parte da serie." }
        : { status: "unavailable", message: "Nao consegui buscar a proxima parte agora." };
    }
    throw error;
  }
}
