import * as cheerio from "cheerio";

/**
 * Link direto para um arquivo Markdown (um README no GitHub "raw", uma nota
 * publicada como .md).
 *
 * A importacao por link tratava a resposta como pagina HTML: o texto chegava
 * com `#`, `**`, `-` e `[...](...)` crus. Aqui se decide quando a resposta e
 * Markdown, para o texto ser salvo com `format: "markdown"` e lido como um
 * arquivo .md importado.
 */

const MARKDOWN_PATH = /\.(md|markdown|mdown|mkd|mkdn)$/i;
const MARKDOWN_MIME = /^text\/(x-)?markdown$/;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/** O endereco aponta para um arquivo .md (pelo caminho, sem a query). */
export function isMarkdownPath(url: string): boolean {
  return MARKDOWN_PATH.test(pathOf(url));
}

/**
 * A resposta e Markdown: o tipo declarado diz, ou e texto simples (ou sem
 * tipo) vindo de um caminho .md. O GitHub "raw" serve README.md como
 * `text/plain`.
 */
export function isMarkdownResponse(contentType: string, url: string): boolean {
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  if (MARKDOWN_MIME.test(mime)) return true;
  return (mime === "" || mime === "text/plain") && isMarkdownPath(url);
}

/**
 * Pagina que o navegador montou para exibir um arquivo de texto: o favorito
 * "Enviar para o Leitura" manda esse HTML, com o arquivo inteiro dentro de um
 * unico `<pre>`. Devolve o texto do arquivo, ou null quando a pagina e outra
 * coisa.
 */
export function markdownFromBrowserView(html: string, url: string): string | null {
  if (!isMarkdownPath(url)) return null;
  const $ = cheerio.load(html);
  const children = $("body")
    .children()
    .filter((_, element) => !["script", "style", "link", "meta"].includes(element.tagName));
  if (children.length !== 1 || !children.first().is("pre")) return null;
  const text = children.first().text();
  return text.trim() ? text : null;
}

/** Texto do arquivo pronto para salvar: sem BOM e com quebras de linha Unix. */
export function normalizeMarkdown(source: string): string {
  return source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
}

/** Titulo pelo nome do arquivo: "guia-de-estilo.md" vira "guia de estilo". */
export function titleFromMarkdownPath(url: string): string | null {
  const name = pathOf(url).split("/").filter(Boolean).pop();
  if (!name) return null;
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // Nome com escape invalido: fica como veio.
  }
  const title = decoded.replace(MARKDOWN_PATH, "").replace(/[-_]+/g, " ").trim();
  return title || null;
}

/** Campos `title` e `author` do front matter YAML, quando o arquivo tem. */
export function frontMatterField(source: string, field: "title" | "author"): string | null {
  const lines = source.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === "---") return null;
    const match = new RegExp(`^${field}\\s*:\\s*(.+)$`, "i").exec(line.trim());
    if (match) {
      const value = match[1]!.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
      return value || null;
    }
  }
  return null;
}
