import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bookmarks, highlights, texts } from "@/db/schema";
import { stripCitations } from "@/lib/citations";
import { asTextFormat, parseParagraphs } from "@/lib/reading";
import { alignRemoval, forwardMap, inverseMap, mapSpan, unmapSpan } from "@/lib/reindex";

export type ReprocessResult =
  | { status: "done"; removedWords: number; wordCount: number }
  | { status: "unchanged" | "not-found" | "unsafe" | "no-original"; message: string };

/**
 * Omite ou restaura as referencias de um texto ja salvo.
 *
 * O conteudo muda, e com ele os indices de palavra: posicao de leitura,
 * destaques e marcadores sao remapeados pela mesma tabela, na mesma
 * transacao. Quando o casamento entre a lista antiga e a nova falha, nada e
 * gravado - remapear por aproximacao moveria destaques para outras palavras.
 */
export async function reprocessCitations(
  userId: string,
  textId: string,
  mode: "omitir" | "restaurar"
): Promise<ReprocessResult> {
  const [text] = await db
    .select()
    .from(texts)
    .where(and(eq(texts.id, textId), eq(texts.userId, userId)))
    .limit(1);
  if (!text) return { status: "not-found", message: "Texto nao encontrado." };

  const format = asTextFormat(text.format);
  const current = parseParagraphs(text.content, format).words;

  let nextContent: string;
  let original: string | null;
  // `toNew[i]` e a posicao nova da palavra atual i (com uma entrada para o fim).
  let toNew: number[];
  let span: (value: { start: number; end: number }) => { start: number; end: number } | null;

  if (mode === "omitir") {
    const stripped = stripCitations(text.content);
    if (stripped.removed === 0 && !stripped.referencesCut) {
      return { status: "unchanged", message: "Nenhuma referencia encontrada neste texto." };
    }
    const next = parseParagraphs(stripped.text, format).words;
    const matched = alignRemoval(current, next);
    if (!matched || next.length === 0) {
      return { status: "unsafe", message: "Nao foi possivel omitir as referencias sem mover os destaques." };
    }
    toNew = forwardMap(current.length, matched);
    span = (value) => mapSpan(value, toNew);
    nextContent = stripped.text;
    // Reprocessar de novo mantem o primeiro original: e ele que desfaz tudo.
    original = text.originalContent ?? text.content;
  } else {
    if (text.originalContent === null) {
      return { status: "no-original", message: "Este texto nao teve referencias omitidas." };
    }
    const restored = parseParagraphs(text.originalContent, format).words;
    const matched = alignRemoval(restored, current);
    if (!matched) {
      return {
        status: "unsafe",
        message: "O texto mudou depois de omitir as referencias; nao da para restaurar sem mover os destaques.",
      };
    }
    const inverse = inverseMap(matched, restored.length);
    toNew = inverse;
    span = (value) => unmapSpan(value, inverse);
    nextContent = text.originalContent;
    original = null;
  }

  const wordCount = parseParagraphs(nextContent, format).words.length;
  const position = (index: number) => Math.min(toNew[Math.min(index, current.length)] ?? wordCount, wordCount);

  await db.transaction(async (tx) => {
    const progressIndex = position(text.progressIndex);
    await tx
      .update(texts)
      .set({
        content: nextContent,
        originalContent: original,
        wordCount,
        progressIndex,
        // Palavras que faltavam ao largar (US-81) seguem a contagem nova.
        ...(text.abandonedAt ? { abandonedWords: Math.max(0, wordCount - progressIndex) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(texts.id, text.id));

    const marks = await tx.select().from(highlights).where(eq(highlights.textId, text.id));
    for (const mark of marks) {
      const moved = span({ start: mark.startIndex, end: mark.endIndex });
      if (!moved) await tx.delete(highlights).where(eq(highlights.id, mark.id));
      else if (moved.start !== mark.startIndex || moved.end !== mark.endIndex) {
        await tx
          .update(highlights)
          .set({ startIndex: moved.start, endIndex: moved.end, updatedAt: new Date() })
          .where(eq(highlights.id, mark.id));
      }
    }

    const points = await tx.select().from(bookmarks).where(eq(bookmarks.textId, text.id));
    for (const point of points) {
      if (point.position >= current.length) continue; // ja estava fora do texto
      const moved = Math.min(position(point.position), Math.max(0, wordCount - 1));
      if (moved !== point.position) {
        await tx.update(bookmarks).set({ position: moved }).where(eq(bookmarks.id, point.id));
      }
    }
  });

  return { status: "done", removedWords: current.length - wordCount, wordCount };
}
