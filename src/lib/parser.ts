import * as cheerio from "cheerio";

export interface ParsedText {
  title: string;
  content: string;
  wordCount: number;
}

export function extractTextFromHtml(html: string, url: string): ParsedText {
  const $ = cheerio.load(html);

  // Remove script, style, nav, header, footer, aside elements
  $("script, style, nav, header, footer, aside, .nav, .nav-bar, .navigation, iframe, .ads, .advertisement, .sidebar").remove();

  // Try to find the main content area
  let contentSelector = "article, .post-content, .article-content, .entry-content, .content, main, .main-content, .body-text";
  let $content = $(contentSelector);

  if ($content.length === 0) {
    // Fallback: get all paragraphs
    $content = $("p");
  }

  // If we found paragraphs within a specific container, use that; otherwise use all p tags
  const paragraphs = $content.length > 0 ? $content.find("p").addBack() : $("p");

  const textParts: string[] = [];

  paragraphs.each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 20) {
      // Clean up extra whitespace
      const cleaned = text.replace(/\s+/g, " ").trim();
      if (cleaned.length > 0) {
        textParts.push(cleaned);
      }
    }
  });

  // Also get headings for context
  $("h1, h2, h3").each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 5 && text.length < 200) {
      textParts.push(`\n${text}\n`);
    }
  });

  const fullText = textParts.join("\n\n");

  // Extract title
  let title = $("title").text().trim();
  if (!title || title.length < 3) {
    title = $("h1").first().text().trim() || "Untitled";
  }
  // Clean title
  title = title.replace(/\s*[-|]\s*.*$/, "").trim();
  if (title.length > 100) title = title.substring(0, 100);

  // Count words
  const words = fullText.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  return {
    title,
    content: fullText,
    wordCount,
  };
}

export function parseWordList(content: string): { word: string; index: number }[] {
  const words = content.split(/\s+/).filter(w => w.length > 0);
  return words.map((word, index) => ({
    word: word.replace(/[^a-zA-Z0-9'-]/g, ""),
    index,
  })).filter(item => item.word.length > 0);
}
