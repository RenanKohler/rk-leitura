import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tags, textTags } from "@/db/schema";
import { tagKey } from "@/lib/tags";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Deixa as etiquetas do texto exatamente como a lista pedida.
 *
 * Cria o que falta pelo nome, reaproveita o que ja existe e desfaz os
 * vinculos que sobraram. A etiqueta em si nao e apagada: ela pode estar em
 * outros textos, e some da conta apenas quando o leitor a exclui.
 */
export async function applyTags(
  tx: Tx,
  userId: string,
  textId: string,
  names: string[]
): Promise<void> {
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
