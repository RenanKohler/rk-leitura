/**
 * Secoes sugeridas para um texto longo sem titulos (US-153). Funcoes puras,
 * com teste.
 *
 * As secoes ficam fora do conteudo, em `texts.sections`: cada uma guarda a
 * posicao (indice da palavra) do paragrafo onde comeca e o titulo. Assim a
 * contagem de palavras e as posicoes dos destaques nao mudam. O modelo
 * aponta numeros de paragrafo; a conversao para posicao e a validacao sao
 * feitas aqui, contra o texto como o leitor o divide.
 */

import { textHeadings, type Heading } from "@/lib/navigation";
import { startsParagraph, type Paragraph } from "@/lib/reading";

/** Abaixo disso o texto se navega rolando: a opcao nao aparece. */
export const MIN_SECTION_WORDS = 5_000;
export const MIN_SECTIONS = 3;
export const MAX_SECTIONS = 30;
export const MAX_SECTION_TITLE_WORDS = 8;

/** Tamanho de cada parte do pedido: acima disso o texto vai em partes. */
export const SECTION_PART_CHARS = 200_000;

/** Teto de cada paragrafo no pedido: para achar a virada de assunto, basta. */
export const MAX_SECTION_PARAGRAPH_CHARS = 1_200;

export interface Section {
  /** Posicao da primeira palavra do paragrafo onde a secao comeca. */
  index: number;
  title: string;
}

/** A opcao aparece so em texto longo e sem titulos proprios. */
export function canSuggestSections(wordCount: number, paragraphs: Paragraph[]): boolean {
  return wordCount >= MIN_SECTION_WORDS && textHeadings(paragraphs).length === 0;
}

export interface SectionPart {
  /** Paragrafos numerados entre colchetes, como na limpeza (US-136). */
  prompt: string;
  /** Primeiro e ultimo numero de paragrafo da parte. */
  first: number;
  last: number;
  /** Quantas secoes, no maximo, pedir a esta parte. */
  maxSections: number;
}

/**
 * Paragrafos numerados, em partes de ate `maxChars`. A numeracao e a do texto
 * inteiro, entao a resposta de cada parte aponta direto para o paragrafo. O
 * teto de secoes se divide entre as partes pelo tamanho de cada uma.
 */
export function sectionParts(
  paragraphs: Paragraph[],
  maxChars: number = SECTION_PART_CHARS
): SectionPart[] {
  const parts: { lines: string[]; first: number; last: number; size: number }[] = [];
  let current: (typeof parts)[number] | null = null;

  for (const [number, paragraph] of paragraphs.entries()) {
    if (paragraph.words.length === 0) continue;
    const text = paragraph.words.join(" ");
    const clipped =
      text.length > MAX_SECTION_PARAGRAPH_CHARS
        ? `${text.slice(0, MAX_SECTION_PARAGRAPH_CHARS)}...`
        : text;
    const line = `[${number}] ${clipped}`;
    if (!current || (current.size + line.length > maxChars && current.lines.length > 0)) {
      current = { lines: [], first: number, last: number, size: 0 };
      parts.push(current);
    }
    current.lines.push(line);
    current.last = number;
    current.size += line.length + 1;
  }

  const total = parts.reduce((sum, part) => sum + part.size, 0);
  return parts.map((part) => ({
    prompt: part.lines.join("\n"),
    first: part.first,
    last: part.last,
    maxSections:
      parts.length === 1
        ? MAX_SECTIONS
        : Math.max(1, Math.floor((MAX_SECTIONS * part.size) / Math.max(1, total))),
  }));
}

/** Titulo limpo: sem aspas, numeracao ou pontuacao final, ate 8 palavras. */
export function cleanSectionTitle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const words = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(\d+|[IVXLC]+)[.)\-–—:]\s+/, "")
    .replace(/[.;:,]+$/, "")
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "")
    .replace(/[.;:,]+$/, "")
    .trim()
    .split(" ")
    .filter(Boolean);
  return words.slice(0, MAX_SECTION_TITLE_WORDS).join(" ").slice(0, 120);
}

/**
 * Resposta do modelo convertida em secoes: so numeros de paragrafo
 * existentes e com palavras, uma vez cada, com titulo. Ordenadas, ate o teto.
 */
export function validSections(raw: unknown, paragraphs: Paragraph[]): Section[] {
  if (!Array.isArray(raw)) return [];
  const byIndex = new Map<number, string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { paragraph, title } = item as { paragraph?: unknown; title?: unknown };
    if (typeof paragraph !== "number" || !Number.isInteger(paragraph)) continue;
    const target = paragraphs[paragraph];
    if (!target || target.words.length === 0) continue;
    const clean = cleanSectionTitle(title);
    if (!clean || byIndex.has(target.start)) continue;
    byIndex.set(target.start, clean);
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_SECTIONS)
    .map(([index, title]) => ({ index, title }));
}

/**
 * Secoes guardadas (ou enviadas ao aplicar) que ainda valem para o texto:
 * cada posicao precisa abrir um paragrafo. Uma secao que deixou de casar
 * com o conteudo some do sumario em vez de levar a um lugar errado.
 */
export function storedSections(raw: unknown, paragraphs: Paragraph[]): Section[] {
  if (!Array.isArray(raw)) return [];
  const byIndex = new Map<number, string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { index, title } = item as { index?: unknown; title?: unknown };
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) continue;
    if (!startsParagraph(paragraphs, index)) continue;
    const clean = cleanSectionTitle(title);
    if (!clean || byIndex.has(index)) continue;
    byIndex.set(index, clean);
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_SECTIONS)
    .map(([index, title]) => ({ index, title }));
}

/**
 * Sumario de "Navegar no texto": os titulos do proprio texto e, so quando
 * ele nao tem nenhum, as secoes aplicadas.
 */
export function navigationHeadings(paragraphs: Paragraph[], sections: unknown): Heading[] {
  const headings = textHeadings(paragraphs);
  if (headings.length > 0) return headings;
  return storedSections(sections, paragraphs).map((section) => ({
    level: 1,
    title: section.title,
    start: section.index,
  }));
}
