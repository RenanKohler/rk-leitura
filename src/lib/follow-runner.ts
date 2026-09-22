import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { feeds, seriesFollows, texts } from "@/db/schema";
import { importNextChapter } from "@/lib/chapter-import";
import { newestDate, parseFeed, unseenItems } from "@/lib/feed";
import { afterCheck, MAX_FEED_ITEMS_PER_CHECK, shouldCheck, type CheckOutcome } from "@/lib/follow";
import { ImportError, importFromUrl } from "@/lib/import-text";
import { asLanguage } from "@/lib/language";
import { notifyUser } from "@/lib/notify";
import { findTextBySourceUrl } from "@/lib/queries";
import { countWords } from "@/lib/reading";
import { fetchPublicFeed } from "@/lib/safe-fetch";
import { detectSeries } from "@/lib/series";
import { normalizeSourceUrl, pageFromUrl } from "@/lib/source-url";
import { normalizeTagList } from "@/lib/tags";
import { applyTags } from "@/lib/text-tags";

/**
 * Verificacao periodica de series acompanhadas e feeds (US-70, US-71).
 *
 * Roda dentro do tempo de uma funcao: cada fonte custa uma busca externa, e a
 * rotina para quando o prazo esta perto do fim. O que ficou para tras e o
 * primeiro da proxima execucao, porque a ordem e pela verificacao mais antiga.
 */

export interface FollowReport {
  series: number;
  feeds: number;
  imported: number;
  paused: number;
}

export async function runFollowUps(now: Date, deadline: number): Promise<FollowReport> {
  const report: FollowReport = { series: 0, feeds: 0, imported: 0, paused: 0 };

  const follows = await db
    .select()
    .from(seriesFollows)
    .where(isNull(seriesFollows.pausedAt))
    .orderBy(seriesFollows.lastCheckedAt);

  for (const follow of follows) {
    if (Date.now() > deadline) return report;
    if (!shouldCheck(follow, now)) continue;
    report.series += 1;

    const outcome = await checkSeries(follow.userId, follow.seriesKey, report);
    const next = afterCheck(follow.failures, outcome);
    if (next.paused) report.paused += 1;

    await db
      .update(seriesFollows)
      .set({ lastCheckedAt: now, failures: next.failures, pausedAt: next.paused ? now : null })
      .where(eq(seriesFollows.id, follow.id));
  }

  const subscriptions = await db
    .select()
    .from(feeds)
    .where(isNull(feeds.pausedAt))
    .orderBy(feeds.lastCheckedAt);

  for (const feed of subscriptions) {
    if (Date.now() > deadline) return report;
    if (!shouldCheck(feed, now)) continue;
    report.feeds += 1;

    const { outcome, seenUntil } = await checkFeed(feed, report);
    const next = afterCheck(feed.failures, outcome);
    if (next.paused) report.paused += 1;

    await db
      .update(feeds)
      .set({
        lastCheckedAt: now,
        failures: next.failures,
        pausedAt: next.paused ? now : null,
        seenUntil,
      })
      .where(eq(feeds.id, feed.id));
  }

  return report;
}

/** Procura o capitulo seguinte ao ultimo importado da serie. */
async function checkSeries(
  userId: string,
  seriesKey: string,
  report: FollowReport
): Promise<CheckOutcome> {
  const [last] = await db
    .select({ id: texts.id })
    .from(texts)
    .where(and(eq(texts.userId, userId), eq(texts.seriesKey, seriesKey)))
    .orderBy(desc(texts.chapter))
    .limit(1);

  // A serie foi desfeita ou apagada: nada a procurar, e nao e falha da origem.
  if (!last) return "nada";

  try {
    const result = await importNextChapter(userId, last.id, { automatic: true });
    if (result.status === "unavailable") return "falha";
    if (result.status !== "imported") return "nada";

    report.imported += 1;
    await notifyUser(userId, {
      title: "Capitulo novo",
      body: result.title,
      url: `/leitor/${result.id}`,
    });
    return "novo";
  } catch (error) {
    console.error("[acompanhamento] falha na serie:", error instanceof Error ? error.message : error);
    return "falha";
  }
}

/** Importa os itens publicados depois da ultima verificacao. */
async function checkFeed(
  feed: typeof feeds.$inferSelect,
  report: FollowReport
): Promise<{ outcome: CheckOutcome; seenUntil: Date | null }> {
  let parsed;
  try {
    const { html, finalUrl } = await fetchPublicFeed(feed.url);
    parsed = parseFeed(html, finalUrl);
  } catch {
    return { outcome: "falha", seenUntil: feed.seenUntil };
  }
  if (!parsed) return { outcome: "falha", seenUntil: feed.seenUntil };

  const fresh = unseenItems(parsed.items, feed.seenUntil, MAX_FEED_ITEMS_PER_CHECK);
  // O limite por verificacao pode deixar itens para a proxima: o marco avanca
  // so ate o ultimo importado, nao ate o mais novo do feed.
  const seenUntil =
    fresh.length > 0 ? newestDate(fresh, feed.seenUntil) : newestDate(parsed.items, feed.seenUntil);

  let imported = 0;
  let failed = 0;
  for (const item of fresh) {
    const url = normalizeSourceUrl(item.link);
    if (await findTextBySourceUrl(feed.userId, [url])) continue;

    try {
      const document = await importFromUrl(url);
      const finalUrl = normalizeSourceUrl(document.sourceUrl);
      if (finalUrl !== url && (await findTextBySourceUrl(feed.userId, [finalUrl]))) continue;
      const series = detectSeries(document.title, finalUrl);

      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(texts)
          .values({
            userId: feed.userId,
            title: document.title.slice(0, 200),
            sourceUrl: finalUrl,
            content: document.content,
            wordCount: countWords(document.content),
            sourcePage: pageFromUrl(finalUrl),
            seriesKey: series?.key ?? null,
            seriesTitle: series?.title ?? null,
            chapter: series?.chapter ?? null,
            language: asLanguage(document.language),
            autoImportedAt: new Date(),
          })
          .returning({ id: texts.id });
        if (row) await applyTags(tx, feed.userId, row.id, normalizeTagList([feed.title]));
      });
      imported += 1;
    } catch (error) {
      // Um item que nao importa nao derruba o feed inteiro.
      if (!(error instanceof ImportError)) throw error;
      failed += 1;
    }
  }

  if (imported > 0) {
    report.imported += imported;
    await notifyUser(feed.userId, {
      title: feed.title,
      body: imported === 1 ? "1 artigo novo na biblioteca." : `${imported} artigos novos na biblioteca.`,
      url: "/textos",
    });
  }

  // Todos os itens novos recusados (o site bloqueia a busca, por exemplo)
  // contam como falha da origem: tres seguidas pausam a assinatura.
  const outcome: CheckOutcome = imported > 0 ? "novo" : failed > 0 ? "falha" : "nada";
  return { outcome, seenUntil };
}
