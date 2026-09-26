import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bookmarks, texts } from "@/db/schema";

export interface BookmarkItem {
  id: string;
  position: number;
  label: string;
  createdAt: string;
}

/** Marcadores do texto, ou null quando o texto nao e do usuario. */
export async function loadBookmarks(
  userId: string,
  textId: string
): Promise<{ wordCount: number; items: BookmarkItem[] } | null> {
  const [text] = await db
    .select({ wordCount: texts.wordCount })
    .from(texts)
    .where(and(eq(texts.id, textId), eq(texts.userId, userId)))
    .limit(1);
  if (!text) return null;

  const rows = await db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.textId, textId), eq(bookmarks.userId, userId)))
    .orderBy(asc(bookmarks.position), asc(bookmarks.createdAt));

  return {
    wordCount: text.wordCount,
    items: rows.map((row) => ({
      id: row.id,
      position: row.position,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
