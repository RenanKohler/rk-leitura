import { NextResponse } from "next/server";
import { and, count, desc, eq, isNotNull, max, ne } from "drizzle-orm";
import { db } from "@/db";
import { texts } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { parseSeriesAssignment, seriesKeyFor, type SeriesOption } from "@/lib/series";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Desfaz o vinculo de serie.
 *
 * `?texto=` solta um capitulo; `?serie=` desfaz o grupo inteiro. A deteccao e
 * heuristica e erra: sem uma forma de desfazer, um agrupamento errado ficaria
 * para sempre.
 */
export async function DELETE(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const params = new URL(request.url).searchParams;
    const textId = params.get("texto");
    const key = params.get("serie");

    const target = textId
      ? UUID_PATTERN.test(textId)
        ? eq(texts.id, textId)
        : null
      : key && key.length <= 300
        ? eq(texts.seriesKey, key)
        : null;

    if (!target) return jsonError("Informe o texto ou a série.", 400);

    const changed = await db
      .update(texts)
      .set({ seriesKey: null, chapter: null })
      .where(and(eq(texts.userId, session.id), target))
      .returning({ id: texts.id });

    return NextResponse.json({ desvinculados: changed.length });
  } catch (error) {
    return serverError("series/unlink", error);
  }
}

/**
 * As series da conta, para a folha "Adicionar a uma serie": nome, maior
 * capitulo e quantos capitulos tem. As mais recentes primeiro.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const rows = await db
      .select({
        key: texts.seriesKey,
        title: max(texts.seriesTitle),
        anyTitle: max(texts.title),
        lastChapter: max(texts.chapter),
        chapters: count(),
        updatedAt: max(texts.updatedAt),
      })
      .from(texts)
      .where(and(eq(texts.userId, session.id), isNotNull(texts.seriesKey)))
      .groupBy(texts.seriesKey)
      .orderBy(desc(max(texts.updatedAt)));

    const series: SeriesOption[] = rows.map((row) => ({
      key: row.key!,
      title: row.title ?? row.anyTitle ?? row.key!,
      lastChapter: row.lastChapter ?? 0,
      chapters: row.chapters,
    }));
    return NextResponse.json({ series });
  } catch (error) {
    return serverError("series/list", error);
  }
}

/**
 * Vincula um texto a uma serie a mao: uma que ja existe ou uma nova, com o
 * numero do capitulo. A deteccao automatica so le o endereco e o titulo, e
 * erra nos dois sentidos; o desvinculo ja existia, faltava o contrario.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{ texto?: unknown }>(request);
    const textId = typeof body?.texto === "string" ? body.texto : "";
    if (!UUID_PATTERN.test(textId)) return jsonError("Informe o texto.", 400);

    const assignment = parseSeriesAssignment(body);
    if (typeof assignment === "string") return jsonError(assignment, 400);

    const mine = eq(texts.userId, session.id);
    let key: string;
    let title: string;
    if (assignment.kind === "existente") {
      const [existing] = await db
        .select({ title: max(texts.seriesTitle), anyTitle: max(texts.title) })
        .from(texts)
        .where(and(mine, eq(texts.seriesKey, assignment.key)));
      if (!existing || (existing.title === null && existing.anyTitle === null)) {
        return jsonError("Série não encontrada.", 404);
      }
      key = assignment.key;
      title = existing.title ?? existing.anyTitle!;
    } else {
      key = seriesKeyFor(assignment.title);
      // Nome igual ao de uma serie que ja existe: entra nela, com o nome dela.
      const [existing] = await db
        .select({ title: max(texts.seriesTitle) })
        .from(texts)
        .where(and(mine, eq(texts.seriesKey, key)));
      title = existing?.title ?? assignment.title;
    }

    const [taken] = await db
      .select({ title: texts.title })
      .from(texts)
      .where(
        and(mine, eq(texts.seriesKey, key), eq(texts.chapter, assignment.chapter), ne(texts.id, textId))
      )
      .limit(1);
    if (taken) {
      return jsonError(
        `O capítulo ${assignment.chapter} desta série já é "${taken.title}". Escolha outro número.`,
        409
      );
    }

    const [updated] = await db
      .update(texts)
      .set({ seriesKey: key, seriesTitle: title, chapter: assignment.chapter })
      .where(and(mine, eq(texts.id, textId)))
      .returning({ id: texts.id });
    if (!updated) return jsonError("Texto não encontrado.", 404);

    return NextResponse.json({ seriesKey: key, seriesTitle: title, chapter: assignment.chapter });
  } catch (error) {
    return serverError("series/link", error);
  }
}
