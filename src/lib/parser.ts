import * as cheerio from "cheerio";
import { countWords } from "@/lib/reading";

export interface ParsedText {
  title: string;
  content: string;
  wordCount: number;
}

const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "iframe",
  "figure figcaption",
  "[aria-hidden='true']",
  ".nav",
  ".navbar",
  ".navigation",
  ".menu",
  ".ads",
  ".ad",
  ".advertisement",
  ".sidebar",
  ".comments",
  ".comment",
  ".related",
  ".newsletter",
  ".share",
  ".social",
  ".cookie",
  ".paywall",
].join(", ");

const CONTENT_SELECTORS = [
  "article",
  "[role='main']",
  "main",
  ".post-content",
  ".article-content",
  ".entry-content",
  ".article-body",
  ".post-body",
  ".content",
  ".main-content",
];

/**
 * Extrai o texto principal de uma pagina HTML.
 *
 * Mantem a ordem do documento (a versao anterior empilhava todos os titulos no
 * fim, embaralhando o artigo) e escolhe o container com mais texto em vez do
 * primeiro que casa com o seletor.
 */
export function extractTextFromHtml(html: string): ParsedText {
  const $ = cheerio.load(html);

  const title = extractTitle($);
  $(NOISE_SELECTORS).remove();

  let best: cheerio.Cheerio<never> | null = null;
  let bestLength = 0;

  for (const selector of CONTENT_SELECTORS) {
    $(selector).each((_, element) => {
      const candidate = $(element) as unknown as cheerio.Cheerio<never>;
      const length = candidate.text().replace(/\s+/g, " ").trim().length;
      if (length > bestLength) {
        best = candidate;
        bestLength = length;
      }
    });
  }

  const root = best && bestLength > 400 ? best : ($("body") as unknown as cheerio.Cheerio<never>);

  const blocks: string[] = [];
  root.find("h1, h2, h3, h4, p, li, blockquote, pre").each((_, element) => {
    const node = $(element);
    // Evita duplicar: um <li> dentro de <blockquote> ja vem no bloco externo.
    if (node.parents("blockquote, pre").length > 0) return;

    const text = node.text().replace(/\s+/g, " ").trim();
    if (text.length < 2) return;

    const tag = (element as { tagName?: string }).tagName?.toLowerCase() ?? "";
    const isHeading = /^h[1-4]$/.test(tag);

    if (!isHeading && text.length < 25) return;
    if (isHeading && text.length > 200) return;

    blocks.push(text);
  });

  const seen = new Set<string>();
  const content = blocks
    .filter((block) => {
      const key = block.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n\n");

  return { title, content, wordCount: countWords(content) };
}

function extractTitle($: cheerio.CheerioAPI): string {
  const candidates = [
    $("meta[property='og:title']").attr("content"),
    $("h1").first().text(),
    $("title").text(),
  ];

  for (const candidate of candidates) {
    const cleaned = (candidate ?? "").replace(/\s+/g, " ").trim();
    if (cleaned.length >= 3) {
      // Remove o sufixo do site: "Titulo do artigo | Nome do Jornal".
      const withoutSuffix = cleaned.replace(/\s+[|–—-]\s+[^|–—-]{1,40}$/, "").trim();
      const chosen = withoutSuffix.length >= 10 ? withoutSuffix : cleaned;
      return chosen.length > 120 ? `${chosen.slice(0, 117)}...` : chosen;
    }
  }

  return "Sem titulo";
}
