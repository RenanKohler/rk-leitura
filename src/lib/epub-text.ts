/**
 * Leitura de EPUB.
 *
 * Um EPUB e um zip com um indice (`.opf`) que diz a ordem dos capitulos e um
 * arquivo XHTML por capitulo. O que importa aqui e a ordem - ela e o que
 * distingue um livro de uma pilha de textos soltos.
 *
 * Funcoes puras sobre o conteudo dos arquivos; abrir o zip em si fica no
 * cliente, como no PDF, para nao mandar o arquivo inteiro pela rede.
 */

/** Limite do arquivo enviado. */
export const MAX_EPUB_BYTES = 30 * 1024 * 1024;

/** Capitulos com menos que isso quase sempre sao capa, creditos ou sumario. */
export const MIN_CHAPTER_WORDS = 120;

export class EpubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpubError";
  }
}

export interface EpubChapter {
  /** Caminho do arquivo dentro do zip. */
  href: string;
  title: string;
  content: string;
  words: number;
}

/** Caminho do `.opf` declarado no container. */
export function opfPath(containerXml: string): string {
  const match = /full-path="([^"]+)"/i.exec(containerXml);
  if (!match) throw new EpubError("Este arquivo nao parece um EPUB valido.");
  return match[1]!;
}

/** Diretorio base do `.opf`: os caminhos do indice sao relativos a ele. */
export function baseDir(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? "" : path.slice(0, at + 1);
}

/** Resolve um caminho relativo, resolvendo tambem os `..` do caminho. */
export function resolvePath(base: string, href: string): string {
  const parts = `${base}${decodeURIComponent(href.split("#")[0] ?? "")}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

export interface EpubIndex {
  title: string;
  author: string | null;
  /** Caminhos dos capitulos, na ordem de leitura. */
  spine: string[];
  /** Titulo por caminho, quando o sumario traz um. */
  titles: Map<string, string>;
}

/**
 * Le o indice do livro.
 *
 * A ordem vem do `spine`, nao do sumario: o sumario e navegacao e pode pular
 * partes, enquanto o spine e a ordem em que o livro foi montado.
 */
export function parseOpf(opfXml: string, base: string): EpubIndex {
  if (/<encryption|urn:oasis:names:tc:opendocument:xmlns:container.*encryption/i.test(opfXml)) {
    throw new EpubError("Este EPUB tem protecao de copia e nao pode ser importado.");
  }

  const title = text(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opfXml)?.[1]) ?? "Livro";
  const author = text(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opfXml)?.[1]);

  // manifest: id -> href
  const manifest = new Map<string, string>();
  for (const item of opfXml.matchAll(/<item\b[^>]*>/gi)) {
    const tag = item[0];
    const id = /\bid="([^"]+)"/i.exec(tag)?.[1];
    const href = /\bhref="([^"]+)"/i.exec(tag)?.[1];
    const type = /\bmedia-type="([^"]+)"/i.exec(tag)?.[1] ?? "";
    if (id && href && /xhtml|html/i.test(type)) manifest.set(id, href);
  }

  const spine: string[] = [];
  for (const ref of opfXml.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = /\bidref="([^"]+)"/i.exec(ref[0])?.[1];
    const href = idref ? manifest.get(idref) : undefined;
    if (href) spine.push(resolvePath(base, href));
  }

  if (spine.length === 0) {
    throw new EpubError("Nao encontrei capitulos neste EPUB.");
  }

  return { title, author, spine, titles: new Map() };
}

/** Titulos do sumario, por caminho de arquivo. */
export function parseToc(tocXml: string, base: string): Map<string, string> {
  const titles = new Map<string, string>();

  // EPUB 2 (NCX): navPoint com text e content.
  for (const point of tocXml.matchAll(/<navPoint[\s\S]*?<\/navPoint>/gi)) {
    const label = text(/<text>([\s\S]*?)<\/text>/i.exec(point[0])?.[1]);
    const src = /<content[^>]*src="([^"]+)"/i.exec(point[0])?.[1];
    if (label && src) titles.set(resolvePath(base, src), label);
  }

  // EPUB 3 (nav.xhtml): lista de ancoras.
  for (const anchor of tocXml.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const path = resolvePath(base, anchor[1]!);
    const label = text(stripTags(anchor[2]!));
    if (label && !titles.has(path)) titles.set(path, label);
  }

  return titles;
}

const BLOCK_END = /<\/(p|div|h[1-6]|li|blockquote|section|article|tr)>/gi;
const BREAK = /<br\s*\/?>/gi;

/**
 * Texto de um capitulo, com os paragrafos preservados.
 *
 * O fim de cada bloco vira quebra dupla antes de as marcacoes sairem: sem
 * isso o capitulo inteiro chega como um paragrafo unico, que e exatamente o
 * defeito que a importacao por link ja teve.
 */
export function chapterText(xhtml: string): string {
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(xhtml)?.[1] ?? xhtml;

  return decodeEntities(
    stripTags(
      body
        .replace(/<(script|style|head|nav)[\s\S]*?<\/\1>/gi, " ")
        .replace(BREAK, "\n")
        .replace(BLOCK_END, "\n\n")
    )
  )
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Titulo do capitulo: o do sumario, ou o primeiro cabecalho do arquivo. */
export function chapterTitle(xhtml: string, fallback: string): string {
  const heading = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(xhtml)?.[1];
  const fromHeading = text(decodeEntities(stripTags(heading ?? "")));
  return (fromHeading ?? fallback).slice(0, 200);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function text(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const clean = decodeEntities(value).replace(/\s+/g, " ").trim();
  return clean.length > 0 ? clean : null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}
