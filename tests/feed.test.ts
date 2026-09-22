import { describe, expect, it } from "vitest";
import { newestDate, parseFeed, unseenItems } from "@/lib/feed";
import { afterCheck, MAX_FAILURES, shouldCheck } from "@/lib/follow";

const rss = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Blog de Contos</title>
<item><title>Parte 2</title><link>https://exemplo.com/p2</link><pubDate>Tue, 22 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>Parte 1</title><link>/p1</link><pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>Sem link</title></item>
</channel></rss>`;

const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Revista</title>
<entry><title>Artigo</title><link rel="alternate" href="https://revista.com/a"/><updated>2026-09-20T08:00:00Z</updated></entry>
</feed>`;

describe("leitura de feed", () => {
  it("le RSS com links relativos resolvidos", () => {
    const feed = parseFeed(rss, "https://exemplo.com/feed.xml");
    expect(feed?.title).toBe("Blog de Contos");
    expect(feed?.items.map((item) => item.link)).toEqual([
      "https://exemplo.com/p2",
      "https://exemplo.com/p1",
    ]);
  });

  it("le Atom", () => {
    const feed = parseFeed(atom, "https://revista.com/feed");
    expect(feed?.title).toBe("Revista");
    expect(feed?.items[0]).toMatchObject({ title: "Artigo", link: "https://revista.com/a" });
  });

  it("recusa o que nao e feed", () => {
    expect(parseFeed("<html><body><p>oi</p></body></html>", "https://x.com")).toBeNull();
  });

  it("so importa o que veio depois da ultima verificacao, do mais antigo ao mais novo", () => {
    const feed = parseFeed(rss, "https://exemplo.com/feed.xml")!;
    const since = new Date("2026-09-20T00:00:00Z");
    expect(unseenItems(feed.items, since, 5).map((item) => item.title)).toEqual([
      "Parte 1",
      "Parte 2",
    ]);
    expect(unseenItems(feed.items, since, 1).map((item) => item.title)).toEqual(["Parte 1"]);
  });

  it("a primeira verificacao nao importa o arquivo do site", () => {
    const feed = parseFeed(rss, "https://exemplo.com/feed.xml")!;
    expect(unseenItems(feed.items, null, 5)).toEqual([]);
    expect(newestDate(feed.items, null)?.toISOString()).toBe("2026-09-22T10:00:00.000Z");
  });
});

describe("regras do acompanhamento", () => {
  const now = new Date("2026-09-22T12:00:00Z");

  it("verifica no maximo a cada 6 horas", () => {
    expect(shouldCheck({ lastCheckedAt: null, pausedAt: null }, now)).toBe(true);
    expect(
      shouldCheck({ lastCheckedAt: new Date("2026-09-22T07:00:00Z"), pausedAt: null }, now)
    ).toBe(false);
    expect(
      shouldCheck({ lastCheckedAt: new Date("2026-09-22T05:00:00Z"), pausedAt: null }, now)
    ).toBe(true);
  });

  it("pausado nao e verificado", () => {
    expect(shouldCheck({ lastCheckedAt: null, pausedAt: now }, now)).toBe(false);
  });

  it("pausa na terceira falha seguida; nada novo nao conta", () => {
    let state = { failures: 0, paused: false };
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) state = afterCheck(state.failures, "falha");
    expect(state.paused).toBe(false);
    expect(afterCheck(state.failures, "nada")).toEqual({ failures: 0, paused: false });
    expect(afterCheck(state.failures, "falha").paused).toBe(true);
  });
});
