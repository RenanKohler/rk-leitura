import { NextResponse } from "next/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { bookmarks, highlights, texts } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { BatchSchema, UNRECOGNIZED } from "@/lib/backup";
import { normalizeRange } from "@/lib/highlights";
import { asLanguage } from "@/lib/language";
import { MAX_BOOKMARK_LABEL, MAX_BOOKMARKS } from "@/lib/navigation";
import { asTextFormat, countWords } from "@/lib/reading";
import { detectSeries } from "@/lib/series";
import { normalizeSourceUrl, pageFromUrl } from "@/lib/source-url";
import { normalizeTagList } from "@/lib/tags";
import { applyTags } from "@/lib/text-tags";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Restaura um lote de textos do arquivo da biblioteca (US-98).
 *
 * O navegador valida o arquivo inteiro e manda em lotes, porque a funcao
 * recebe no maximo 4,5 MB por requisicao. Cada lote grava em uma transacao;
 * se um lote falha, o navegador apaga os anteriores pelo DELETE abaixo, e a
 * restauracao termina sem nada gravado.
 *
 * Texto com a mesma origem de um que ja esta na conta e pulado: restaurar
 * duas vezes o mesmo arquivo nao duplica a biblioteca.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`importar:${session.id}`, 60, 15 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas importacoes seguidas. Aguarde alguns minutos.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const parsed = BatchSchema.safeParse(await readJson(request));
    if (!parsed.success) return jsonError(UNRECOGNIZED, 400);

    const existing = await db
      .select({ sourceUrl: texts.sourceUrl })
      .from(texts)
      .where(and(eq(texts.userId, session.id), isNotNull(texts.sourceUrl)));
    const known = new Set(existing.map((row) => row.sourceUrl));

    const created: string[] = [];
    let skipped = 0;

    await db.transaction(async (tx) => {
      for (const item of parsed.data.textos) {
        const sourceUrl = item.origem ? normalizeSourceUrl(item.origem) : null;
        if (sourceUrl && known.has(sourceUrl)) {
          skipped += 1;
          continue;
        }

        const format = asTextFormat(item.formato);
        const wordCount = countWords(item.conteudo, format);
        if (wordCount === 0) {
          skipped += 1;
          continue;
        }

        const series = detectSeries(item.titulo, sourceUrl);
        const [row] = await tx
          .insert(texts)
          .values({
            userId: session.id,
            title: item.titulo.slice(0, 200),
            sourceUrl,
            content: item.conteudo,
            format,
            language: asLanguage(item.idioma),
            wordCount,
            progressIndex: Math.min(item.progresso ?? 0, wordCount),
            sourcePage: item.parteDaOrigem ?? pageFromUrl(sourceUrl),
            seriesKey: series?.key ?? null,
            seriesTitle: series?.title ?? null,
            chapter: series?.chapter ?? null,
            archivedAt: item.arquivadoEm ? new Date(item.arquivadoEm) : null,
            ...(item.criadoEm ? { createdAt: new Date(item.criadoEm) } : {}),
          })
          .returning({ id: texts.id });
        if (!row) continue;

        created.push(row.id);
        if (sourceUrl) known.add(sourceUrl);

        const marks = (item.destaques ?? [])
          .map((mark) => ({ range: normalizeRange(mark.inicio, mark.fim, wordCount), note: mark.nota }))
          .filter((mark) => mark.range !== null);
        if (marks.length > 0) {
          await tx.insert(highlights).values(
            marks.map((mark) => ({
              userId: session.id,
              textId: row.id,
              startIndex: mark.range!.start,
              endIndex: mark.range!.end,
              note: mark.note?.trim() || null,
            }))
          );
        }

        const points = (item.marcadores ?? []).slice(0, MAX_BOOKMARKS);
        if (points.length > 0) {
          await tx.insert(bookmarks).values(
            points.map((point) => ({
              userId: session.id,
              textId: row.id,
              position: point.posicao,
              label: point.nome.slice(0, MAX_BOOKMARK_LABEL),
            }))
          );
        }

        const tagNames = normalizeTagList(item.etiquetas ?? []);
        if (tagNames.length > 0) await applyTags(tx, session.id, row.id, tagNames);
      }
    });

    return NextResponse.json({ created, skipped }, { status: 201 });
  } catch (error) {
    return serverError("importar", error);
  }
}

/** Desfaz uma restauracao interrompida: apaga os textos que ela criou. */
export async function DELETE(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{ ids?: unknown }>(request);
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id): id is string => typeof id === "string" && UUID_PATTERN.test(id))
      : [];
    if (ids.length === 0) return NextResponse.json({ removed: 0 });

    const removed = await db
      .delete(texts)
      .where(and(eq(texts.userId, session.id), inArray(texts.id, ids.slice(0, 5000))))
      .returning({ id: texts.id });
    return NextResponse.json({ removed: removed.length });
  } catch (error) {
    return serverError("importar/desfazer", error);
  }
}
