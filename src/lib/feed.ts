import * as cheerio from "cheerio";

/**
 * Leitura de feeds RSS 2.0 e Atom (US-71).
 *
 * So o que a assinatura usa: o nome do feed e, de cada item, titulo, link e
 * data. O texto do artigo nao vem do feed - muitos publicam so um resumo -, e
 * sim da importacao normal do link.
 */

export interface FeedItem {
  title: string;
  link: string;
  published: Date | null;
}

export interface ParsedFeed {
  title: string;
  items: FeedItem[];
}

function clean(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function asDate(value: string | undefined): Date | null {
  const text = clean(value);
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time);
}

function absolute(link: string, base: string): string | null {
  // Link vazio resolveria para o proprio feed.
  if (!link) return null;
  try {
    const url = new URL(link, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Devolve null quando o documento nao e um feed RSS ou Atom. */
export function parseFeed(xml: string, baseUrl: string): ParsedFeed | null {
  const $ = cheerio.load(xml, { xml: true });

  const rss = $("rss > channel, rdf\\:RDF > channel").first();
  if (rss.length > 0) {
    const items: FeedItem[] = [];
    $("item").each((_, element) => {
      const item = $(element);
      const link = absolute(clean(item.children("link").first().text()), baseUrl);
      if (!link) return;
      items.push({
        title: clean(item.children("title").first().text()) || link,
        link,
        published: asDate(
          item.children("pubDate").first().text() || item.children("dc\\:date").first().text()
        ),
      });
    });
    return { title: clean(rss.children("title").first().text()) || baseUrl, items };
  }

  const atom = $("feed").first();
  if (atom.length > 0) {
    const items: FeedItem[] = [];
    atom.children("entry").each((_, element) => {
      const entry = $(element);
      const links = entry.children("link");
      const alternate =
        links.filter((_, link) => ($(link).attr("rel") ?? "alternate") === "alternate").first()
          .attr("href") ?? links.first().attr("href");
      const link = alternate ? absolute(alternate, baseUrl) : null;
      if (!link) return;
      items.push({
        title: clean(entry.children("title").first().text()) || link,
        link,
        published: asDate(
          entry.children("published").first().text() || entry.children("updated").first().text()
        ),
      });
    });
    return { title: clean(atom.children("title").first().text()) || baseUrl, items };
  }

  return null;
}

/**
 * Itens que ainda nao foram vistos, do mais antigo ao mais novo, ate o limite.
 *
 * Na primeira verificacao (`seenUntil` nulo) nada e importado: assinar um
 * feed nao despeja o arquivo inteiro do site na biblioteca, so o que vier
 * depois da assinatura.
 */
export function unseenItems(items: FeedItem[], seenUntil: Date | null, limit: number): FeedItem[] {
  if (!seenUntil) return [];
  return items
    .filter((item) => item.published !== null && item.published > seenUntil)
    .sort((a, b) => a.published!.getTime() - b.published!.getTime())
    .slice(0, limit);
}

/**
 * Novo marco depois de processar os itens `fresh`, em ordem de publicacao.
 *
 * Avanca ate o ultimo item resolvido antes da primeira falha passageira: o
 * que falhou por a origem estar fora do ar, e o que vem depois dele, volta na
 * proxima verificacao. Falha definitiva (403, pagina sem texto) conta como
 * resolvida - tentar de novo daria o mesmo resultado e travaria o feed. Os
 * ja importados depois da falha nao duplicam: a importacao confere o
 * endereco antes.
 */
export function advanceWatermark(
  prior: Date | null,
  processed: { published: Date | null; retry: boolean }[]
): Date | null {
  let watermark = prior;
  for (const item of processed) {
    if (item.retry) break;
    if (item.published && (!watermark || item.published > watermark)) watermark = item.published;
  }
  return watermark;
}

/** Data do item mais novo, para a proxima verificacao partir dela. */
export function newestDate(items: FeedItem[], fallback: Date | null): Date | null {
  return items.reduce<Date | null>(
    (latest, item) =>
      item.published && (!latest || item.published > latest) ? item.published : latest,
    fallback
  );
}
