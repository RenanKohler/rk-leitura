/**
 * Importacao de links em lote (PROD-17): ler a lista exportada por outros
 * servicos de "ler depois".
 *
 * Instapaper, Pocket e Readwise exportam CSV com uma coluna de URL; o Pocket
 * antigo exporta HTML com uma lista de `<a href>`. As duas leituras sao puras
 * e toleram o arquivo real, que nem sempre segue o formato: sem coluna com
 * nome conhecido, qualquer celula que pareca endereco serve.
 *
 * Funcoes puras, compartilhadas entre servidor e cliente.
 */

/** Teto de links por lote: acima disso, a importacao levaria horas. */
export const MAX_BATCH_LINKS = 200;

export interface BatchLink {
  url: string;
  /** Titulo que a origem deu ao link, quando havia. */
  title: string | null;
}

const URL_HEADERS = ["url", "link", "href", "address", "endereco"];
const TITLE_HEADERS = ["title", "titulo", "name", "nome"];

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Linhas de um CSV, respeitando aspas: virgula e quebra de linha dentro de
 * aspas sao conteudo, e `""` e uma aspa. Aceita `;` como separador quando a
 * primeira linha tem mais `;` que `,` (planilha em portugues).
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const separator =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((line) => line.some((value) => value.trim().length > 0));
}

/** Links de um CSV exportado: pela coluna de URL, ou por qualquer celula com endereco. */
export function linksFromCsv(text: string): BatchLink[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0]!.map((value) => value.trim().toLowerCase());
  const urlColumn = header.findIndex((name) => URL_HEADERS.includes(name));
  const titleColumn = header.findIndex((name) => TITLE_HEADERS.includes(name));

  const links: BatchLink[] = [];
  const body = urlColumn >= 0 ? rows.slice(1) : rows;
  for (const row of body) {
    const url =
      urlColumn >= 0
        ? (row[urlColumn] ?? "").trim()
        : (row.map((value) => value.trim()).find(isHttpUrl) ?? "");
    if (!isHttpUrl(url)) continue;
    const title = titleColumn >= 0 ? (row[titleColumn] ?? "").trim() : "";
    links.push({ url, title: title || null });
  }
  return links;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

/** Links de um HTML exportado (Pocket): cada `<a href>` com endereco http. */
export function linksFromHtml(html: string): BatchLink[] {
  const links: BatchLink[] = [];
  const pattern = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const url = decodeEntities((match[2] ?? match[3] ?? match[4] ?? "").trim());
    if (!isHttpUrl(url)) continue;
    const title = decodeEntities(match[5]!.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    links.push({ url, title: title && title !== url ? title : null });
  }
  return links;
}

/**
 * Links de um arquivo, pelo nome e pelo conteudo, sem repetidos e no maximo
 * 200. `truncated` diz quantos ficaram de fora pelo teto.
 */
export function linksFromFile(
  name: string,
  content: string
): { links: BatchLink[]; truncated: number } {
  const html = /\.html?$/i.test(name) || /^\s*<(!doctype|html|ul|dl|a)\b/i.test(content);
  const all = html ? linksFromHtml(content) : linksFromCsv(content);

  const seen = new Set<string>();
  const unique = all.filter((link) => {
    const key = link.url.replace(/#.*$/, "").replace(/\/$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    links: unique.slice(0, MAX_BATCH_LINKS),
    truncated: Math.max(0, unique.length - MAX_BATCH_LINKS),
  };
}
