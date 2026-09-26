/**
 * O texto inteiro em Markdown, com os destaques marcados e as notas ao lado
 * (US-100). Funcoes puras.
 *
 * O texto e remontado a partir dos paragrafos, e nao da fonte original: os
 * destaques sao intervalos de palavras, e so nessa visao cada palavra tem
 * indice. Titulos, listas, citacoes, negrito e italico voltam a ser Markdown
 * pelos atributos que o parser ja guarda.
 */

import { STYLE } from "@/lib/markdown";
import { parseParagraphs, type Paragraph, type TextFormat } from "@/lib/reading";
import { exportFileName } from "@/lib/highlights";

export interface AnnotatedMark {
  start: number;
  end: number;
  note: string | null;
}

function styled(word: string, style: number): string {
  if (!style) return word;
  // A pontuacao final fica fora da marca: "*leve*." e nao "*leve.*".
  const [, core = word, tail = ""] = /^(.*?)([.,;:!?…"'»”’)\]]*)$/u.exec(word) ?? [];
  let out = core || word;
  if (style & STYLE.code) out = `\`${out}\``;
  if (style & STYLE.bold && !(style & STYLE.heading)) out = `**${out}**`;
  if (style & STYLE.italic) out = `*${out}*`;
  if (style & STYLE.strike) out = `~~${out}~~`;
  return core ? `${out}${tail}` : out;
}

function prefix(paragraph: Paragraph): string {
  switch (paragraph.kind) {
    case "h1":
      return "# ";
    case "h2":
      return "## ";
    case "h3":
      return "### ";
    case "quote":
      return "> ";
    case "li":
      return "- ";
    case "oli":
      return `${paragraph.marker ?? "1"}. `;
    default:
      return "";
  }
}

export function annotatedMarkdown(
  text: { title: string; sourceUrl: string | null; content: string; format: TextFormat },
  marks: AnnotatedMark[]
): string {
  const { paragraphs } = parseParagraphs(text.content, text.format);
  const sorted = [...marks].sort((a, b) => a.start - b.start);
  const lines: string[] = [`# ${text.title}`, ""];
  if (text.sourceUrl) lines.push(`Origem: <${text.sourceUrl}>`, "");

  for (const paragraph of paragraphs) {
    const end = paragraph.start + paragraph.words.length;
    const parts: string[] = [];
    const notes: string[] = [];

    paragraph.words.forEach((word, offset) => {
      const position = paragraph.start + offset;
      let piece = styled(word, paragraph.styles?.[offset] ?? 0);
      for (const mark of sorted) {
        // Um destaque que atravessa paragrafos e aberto e fechado em cada um:
        // `==` nao atravessa quebra de bloco no Markdown.
        const opens = position === mark.start || (offset === 0 && mark.start < position && mark.end > position);
        const closes = position === mark.end - 1 || (position === end - 1 && mark.end > end && mark.start <= position);
        if (opens && position < mark.end) piece = `==${piece}`;
        if (closes && position >= mark.start) piece = `${piece}==`;
      }
      parts.push(piece);
    });

    for (const mark of sorted) {
      // A nota vai depois do paragrafo onde o destaque termina.
      const lastWord = mark.end - 1;
      if (mark.note && lastWord >= paragraph.start && lastWord < end) {
        notes.push(...mark.note.trim().split("\n").map((line, index) => (index === 0 ? `> **Nota:** ${line}` : `> ${line}`)));
      }
    }

    lines.push(`${prefix(paragraph)}${parts.join(" ")}`, "");
    if (notes.length > 0) lines.push(...notes, "");
  }

  return lines.join("\n");
}

export function annotatedFileName(title: string): string {
  return exportFileName(title).replace(/-destaques\.md$/, "-anotado.md");
}
