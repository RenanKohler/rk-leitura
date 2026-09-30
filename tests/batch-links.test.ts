import { describe, expect, it } from "vitest";
import { linksFromCsv, linksFromFile, linksFromHtml, MAX_BATCH_LINKS, parseCsv } from "@/lib/batch-links";

describe("CSV exportado", () => {
  it("le a coluna URL do Instapaper, com titulo", () => {
    const csv = [
      "URL,Title,Selection,Folder,Timestamp",
      'https://exemplo.com/a,"Artigo A, com virgula",,Unread,1700000000',
      "https://exemplo.com/b,Artigo B,,Archive,1700000001",
    ].join("\n");
    expect(linksFromCsv(csv)).toEqual([
      { url: "https://exemplo.com/a", title: "Artigo A, com virgula" },
      { url: "https://exemplo.com/b", title: "Artigo B" },
    ]);
  });

  it("le o formato do Pocket (title,url,...) e ignora linhas sem endereco", () => {
    const csv = "title,url,time_added,tags,status\nUm,https://a.com/1,1,,unread\nDois,nao-e-url,2,,unread\n";
    expect(linksFromCsv(csv)).toEqual([{ url: "https://a.com/1", title: "Um" }]);
  });

  it("sem cabecalho conhecido, acha o endereco em qualquer celula", () => {
    const csv = "foo;bar\nx;https://b.com/2\n";
    expect(linksFromCsv(csv)).toEqual([{ url: "https://b.com/2", title: null }]);
  });

  it("aspas e quebra de linha dentro da celula", () => {
    expect(parseCsv('a,"linha 1\nlinha ""2"""\nb,c')).toEqual([
      ["a", 'linha 1\nlinha "2"'],
      ["b", "c"],
    ]);
  });
});

describe("HTML exportado", () => {
  it("le cada <a href> do Pocket", () => {
    const html = `<!DOCTYPE html><html><body><h1>Unread</h1><ul>
      <li><a href="https://c.com/x?a=1&amp;b=2" time_added="1">Titulo X</a></li>
      <li><a href='https://c.com/y'>https://c.com/y</a></li>
      <li><a href="javascript:void(0)">nao</a></li>
    </ul></body></html>`;
    expect(linksFromHtml(html)).toEqual([
      { url: "https://c.com/x?a=1&b=2", title: "Titulo X" },
      { url: "https://c.com/y", title: null },
    ]);
  });
});

describe("arquivo", () => {
  it("escolhe o leitor pela extensao, tira repetidos e respeita o teto", () => {
    const rows = Array.from({ length: MAX_BATCH_LINKS + 5 }, (_, i) => `https://d.com/${i}`);
    const csv = ["url", "https://d.com/0", ...rows].join("\n");
    const { links, truncated } = linksFromFile("lista.csv", csv);
    expect(links).toHaveLength(MAX_BATCH_LINKS);
    expect(truncated).toBe(5);
    expect(linksFromFile("ril_export.html", '<a href="https://e.com">e</a>').links).toHaveLength(1);
  });
});
