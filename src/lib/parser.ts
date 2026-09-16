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
  "[class*='sr-only']",
  "[class*='srOnly']",
  "[class*='screen-reader']",
  "[class*='visually-hidden']",
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

/**
 * Container exato do corpo do texto, em ordem de confianca.
 *
 * `[itemprop="articleBody"]` e o microdado schema.org que marca o corpo do
 * artigo. Quando existe, nao ha adivinhacao: e exatamente o texto e nada do
 * entorno da pagina. O Literotica usa esse atributo, e com ele o bloco de
 * anuncios que aparecia antes do conto some por completo.
 */
const EXACT_SELECTORS = ["[itemprop='articleBody']", "article", "[role='main']", "main"];

const FALLBACK_SELECTORS = [
  ".post-content",
  ".article-content",
  ".entry-content",
  ".article-body",
  ".post-body",
  ".content",
  ".main-content",
];

const BLOCK_TAGS = "h1, h2, h3, h4, p, li, blockquote, pre";
const MIN_FALLBACK_BLOCK_CHARS = 25;

export function extractTextFromHtml(html: string): ParsedText {
  const $ = cheerio.load(html);

  const title = extractTitle($);

  // Corpo declarado em JSON-LD, quando o site publica o texto ali.
  const structured = structuredArticleBody($);
  if (structured) {
    return { title, content: structured, wordCount: countWords(structured) };
  }

  $(NOISE_SELECTORS).remove();

  const exact = pickContainer($, EXACT_SELECTORS);
  if (exact) {
    // Container exato: aproveita todo bloco com texto. Filtrar por tamanho
    // aqui descartaria as falas curtas de dialogo, que em ficcao sao a maior
    // parte do texto.
    const content = collectBlocks($, exact, 0);
    if (countWords(content) >= 20) {
      return { title, content, wordCount: countWords(content) };
    }
  }

  const guessed = pickContainer($, FALLBACK_SELECTORS) ?? ($("body") as cheerio.Cheerio<never>);
  const content = collectBlocks($, guessed, MIN_FALLBACK_BLOCK_CHARS);

  return { title, content, wordCount: countWords(content) };
}

/** Maior container entre os seletores dados, pelo volume de texto. */
function pickContainer(
  $: cheerio.CheerioAPI,
  selectors: string[]
): cheerio.Cheerio<never> | null {
  let best: cheerio.Cheerio<never> | null = null;
  let bestLength = 0;

  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const candidate = $(element) as unknown as cheerio.Cheerio<never>;
      const length = candidate.text().replace(/\s+/g, " ").trim().length;
      if (length > bestLength) {
        best = candidate;
        bestLength = length;
      }
    });

    if (best && bestLength > 400) return best;
  }

  return bestLength > 400 ? best : null;
}

/**
 * Le os blocos na ordem do documento, um paragrafo por linha em branco. As
 * quebras importam: sao elas que o leitor usa para separar os paragrafos.
 */
function collectBlocks(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<never>,
  minChars: number
): string {
  const blocks: string[] = [];

  root.find(BLOCK_TAGS).each((_, element) => {
    const node = $(element);
    // Evita duplicar: um <li> dentro de <blockquote> ja vem no bloco externo.
    if (node.parents("blockquote, pre").length > 0) return;

    const text = node.text().replace(/\s+/g, " ").trim();
    if (text.length === 0) return;

    const tag = (element as { tagName?: string }).tagName?.toLowerCase() ?? "";
    const isHeading = /^h[1-4]$/.test(tag);
    if (isHeading && text.length > 200) return;

    if (!isHeading && text.length < minChars) return;

    // Paragrafo feito so de links e navegacao ou anuncio, nao texto.
    if (!isHeading) {
      const linkText = node.find("a").text().replace(/\s+/g, " ").trim();
      if (linkText.length >= text.length * 0.8) return;
    }

    blocks.push(text);
  });

  const seen = new Set<string>();
  return blocks
    .filter((block) => {
      // Titulos curtos podem repetir legitimamente; paragrafos, nao.
      if (block.length < 40) return true;
      const key = block.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n\n");
}

/** Corpo publicado em JSON-LD (schema.org Article.articleBody). */
function structuredArticleBody($: cheerio.CheerioAPI): string | null {
  for (const node of collectJsonLd($)) {
    const body = node.articleBody;
    if (typeof body !== "string") continue;

    const normalized = body
      .replace(/\r\n?/g, "\n")
      .split(/\n+/)
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n");

    if (countWords(normalized) >= 20) return normalized;
  }

  return null;
}

function extractTitle($: cheerio.CheerioAPI): string {
  // `headline` do Article antes de `name`: o no WebPage costuma vir primeiro
  // no documento e carrega o titulo da pagina com o sufixo do site junto.
  const nodes = collectJsonLd($);
  const structuredHeadline =
    firstText(nodes.map((node) => node.headline)) ?? firstText(nodes.map((node) => node.name));

  const candidates = [
    structuredHeadline,
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

function firstText(values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.trim().length >= 3
  );
}

type JsonLdNode = Record<string, unknown> & { articleBody?: unknown; headline?: unknown; name?: unknown };

/** Todos os nos de JSON-LD da pagina, achatando arrays e @graph. */
function collectJsonLd($: cheerio.CheerioAPI): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];

  $("script[type='application/ld+json']").each((_, element) => {
    const raw = $(element).text().trim();
    if (!raw) return;

    try {
      const parsed: unknown = JSON.parse(raw);
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];

      while (queue.length > 0) {
        const item = queue.shift();
        if (!item || typeof item !== "object") continue;

        const record = item as JsonLdNode;
        if (Array.isArray(record["@graph"])) queue.push(...(record["@graph"] as unknown[]));
        nodes.push(record);
      }
    } catch {
      // JSON-LD malformado e comum; seguir com os demais blocos.
    }
  });

  return nodes;
}
