/**
 * Secoes do texto como intervalos de palavras, para as perguntas-guia
 * (US-166) e o explicar com as proprias palavras (US-167). Funcoes puras,
 * com teste.
 *
 * As secoes sao as do sumario (`navigationHeadings`): os titulos do texto ou,
 * sem eles, as secoes aplicadas (US-153). Cada uma vai do titulo ate o
 * proximo titulo, de qualquer nivel.
 */

import type { Heading } from "@/lib/navigation";

export interface TextSection {
  title: string;
  start: number;
  /** Palavra seguinte a ultima da secao. */
  end: number;
}

export function sectionRanges(headings: Heading[], total: number): TextSection[] {
  const sorted = [...headings].filter((heading) => heading.start < total).sort((a, b) => a.start - b.start);
  return sorted.map((heading, position) => ({
    title: heading.title,
    start: heading.start,
    end: Math.min(total, sorted[position + 1]?.start ?? total),
  }));
}

/** Secao que comeca exatamente em `start`, ou null. */
export function sectionStartingAt(sections: TextSection[], start: number): TextSection | null {
  return sections.find((section) => section.start === start) ?? null;
}

/** Indice da secao em que `index` esta, ou -1 antes da primeira. */
export function sectionIndexAt(sections: TextSection[], index: number): number {
  let current = -1;
  for (let position = 0; position < sections.length; position += 1) {
    if (sections[position]!.start <= index) current = position;
    else break;
  }
  return current;
}
