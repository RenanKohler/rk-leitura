import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { highlights, tags, texts, textTags } from "@/db/schema";
import {
  asInteger,
  asString,
  jsonError,
  readJson,
  requireSession,
  serverError,
} from "@/lib/api";
import { loadText } from "@/lib/queries";
import { normalizeTagList, tagKey } from "@/lib/tags";
import { detectSeries } from "@/lib/series";
import { clamp, countWords } from "@/lib/reading";

export const dynamic = "force-dynamic";

const MAX_CONTENT_CHARS = 400_000;

type Params = { params: Promise<{ id: string }> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Todas as consultas filtram por userId: um id valido de outra conta da 404. */
function ownedText(id: string, userId: string) {
  return and(eq(texts.id, id), eq(texts.userId, userId));
}

export async function GET(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    // `loadText` em vez da linha crua: o editor precisa saber quantos
    // destaques existem para avisar que salvar o conteudo vai remove-los.
    const text = await loadText(session.id, id);
    if (!text) return jsonError("Texto nao encontrado.", 404);

    return NextResponse.json({ text });
  } catch (error) {
    return serverError("texts/get", error);
  }
}

export async function PUT(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const body = await readJson<{
      title?: unknown;
      sourceUrl?: unknown;
      content?: unknown;
      tags?: unknown;
    }>(request);
    const title = asString(body?.title);
    const content = asString(body?.content);
    const sourceUrl = asString(body?.sourceUrl);
    // `tags` ausente nao mexe nas etiquetas; lista vazia tira todas.
    const tagNames = body?.tags === undefined ? null : normalizeTagList(body.tags);

    if (!title || !content) {
      return jsonError("Titulo e conteudo sao obrigatorios.", 400);
    }
    if (content.length > MAX_CONTENT_CHARS) {
      return jsonError("O texto e grande demais.", 413);
    }

    const [current] = await db
      .select({ content: texts.content, title: texts.title, seriesKey: texts.seriesKey })
      .from(texts)
      .where(ownedText(id, session.id))
      .limit(1);

    if (!current) return jsonError("Texto nao encontrado.", 404);

    // Trocar so o titulo nao mexe na leitura. E o conteudo que invalida a
    // posicao salva e os indices dos destaques - por isso as duas perdas
    // acontecem juntas, e so quando ele muda de fato.
    const rewritten = current.content !== content;
    const wordCount = countWords(content);

    // O titulo mudou: o capitulo pode ter passado a ser reconhecido, ou
    // deixado de ser. Nao mexe em quem ja foi desvinculado a mao - o
    // desvinculo (US-37, criterio 6) nao pode ser desfeito por uma edicao.
    const retitled = current.title !== title;
    const series =
      retitled && current.seriesKey !== null ? detectSeries(title, sourceUrl) : null;

    const [updated, removed] = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(texts)
        .set({
          title: title.slice(0, 200),
          sourceUrl,
          content,
          wordCount,
          ...(rewritten ? { progressIndex: 0 } : {}),
          ...(retitled && current.seriesKey !== null
            ? { seriesKey: series?.key ?? null, chapter: series?.chapter ?? null }
            : {}),
          updatedAt: new Date(),
        })
        .where(ownedText(id, session.id))
        .returning();

      const dropped = rewritten
        ? await tx
            .delete(highlights)
            .where(eq(highlights.textId, id))
            .returning({ id: highlights.id })
        : [];

      if (tagNames) await applyTags(tx, session.id, id, tagNames);

      return [row, dropped.length] as const;
    });

    if (!updated) return jsonError("Texto nao encontrado.", 404);
    return NextResponse.json({ text: updated, removedHighlights: removed });
  } catch (error) {
    return serverError("texts/update", error);
  }
}

/**
 * Deixa as etiquetas do texto exatamente como a lista pedida.
 *
 * Cria o que falta pelo nome, reaproveita o que ja existe e desfaz os
 * vinculos que sobraram. A etiqueta em si nao e apagada: ela pode estar em
 * outros textos, e some da conta apenas quando o leitor a exclui.
 */
async function applyTags(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  textId: string,
  names: string[]
) {
  const existing = await tx.select().from(tags).where(eq(tags.userId, userId));
  const byKey = new Map(existing.map((tag) => [tagKey(tag.name), tag]));

  const missing = names.filter((name) => !byKey.has(tagKey(name)));
  if (missing.length > 0) {
    const created = await tx
      .insert(tags)
      .values(missing.map((name) => ({ userId, name })))
      .onConflictDoNothing()
      .returning();
    for (const tag of created) byKey.set(tagKey(tag.name), tag);
  }

  const wanted = names
    .map((name) => byKey.get(tagKey(name))?.id)
    .filter((id): id is string => Boolean(id));

  await tx.delete(textTags).where(eq(textTags.textId, textId));
  if (wanted.length > 0) {
    await tx
      .insert(textTags)
      .values(wanted.map((tagId) => ({ textId, tagId })))
      .onConflictDoNothing();
  }
}

/** Salva a posicao de leitura para retomar depois. */
export async function PATCH(request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const body = await readJson<{ progressIndex?: unknown }>(request);
    const progressIndex = asInteger(body?.progressIndex);
    if (progressIndex === null) return jsonError("Posicao invalida.", 400);

    const [current] = await db
      .select({ wordCount: texts.wordCount })
      .from(texts)
      .where(ownedText(id, session.id))
      .limit(1);

    if (!current) return jsonError("Texto nao encontrado.", 404);

    const position = clamp(progressIndex, 0, current.wordCount);

    const [updated] = await db
      .update(texts)
      .set({
        progressIndex: position,
        updatedAt: new Date(),
        // Chegar ao fim tira o texto da lista principal; reiniciar traz de
        // volta. Entre os dois extremos o arquivamento e manual, senao um
        // texto arquivado a mao sumiria de novo a cada palavra lida.
        ...archiveOnProgress(position, current.wordCount),
      })
      .where(ownedText(id, session.id))
      .returning({ id: texts.id, progressIndex: texts.progressIndex });

    return NextResponse.json({ text: updated });
  } catch (error) {
    return serverError("texts/progress", error);
  }
}

/**
 * Arquiva ao concluir, desarquiva ao reiniciar, e nada no meio do caminho.
 *
 * Arquivar tira da fila: um texto ja lido continuar sendo sugerido como
 * proxima leitura seria a fila trabalhando contra quem a montou.
 */
function archiveOnProgress(position: number, wordCount: number) {
  if (wordCount > 0 && position >= wordCount) {
    return { archivedAt: new Date(), queuePosition: null };
  }
  if (position === 0) return { archivedAt: null };
  return {};
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const deleted = await db
      .delete(texts)
      .where(ownedText(id, session.id))
      .returning({ id: texts.id });

    if (deleted.length === 0) return jsonError("Texto nao encontrado.", 404);
    return NextResponse.json({ success: true });
  } catch (error) {
    return serverError("texts/delete", error);
  }
}
