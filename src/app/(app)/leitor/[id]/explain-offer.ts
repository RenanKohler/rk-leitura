/**
 * Quando o leitor oferece "Explicar esta seção com suas palavras" (US-231).
 * Funcoes puras, com teste.
 *
 * A oferta vem quando a leitura cruza o fim de uma secao andando para frente
 * (palavra a palavra, pagina a pagina ou rolando). Um salto longo, pelo
 * sumario ou pela busca, nao conta: o leitor nao leu o que pulou. A ultima
 * secao termina no fim do texto, e ali quem oferece e a tela de conclusao.
 */

import type { TextSection } from "@/lib/text-sections";

/** Maior avanco que ainda conta como leitura (uma pagina cheia, folgada). */
export const MAX_READING_STEP = 1500;

/** Secao curta demais nao rende 30 palavras de explicacao. */
export const MIN_EXPLAIN_SECTION_WORDS = 120;

/**
 * Secao cujo fim a leitura acabou de cruzar, de `previous` para `index`, ou
 * null. Se o passo cruzou mais de um fim, vale a ultima secao.
 */
export function crossedSection(
  sections: TextSection[],
  previous: number,
  index: number,
  total: number
): TextSection | null {
  if (index <= previous || index - previous > MAX_READING_STEP) return null;
  let found: TextSection | null = null;
  for (const section of sections) {
    if (section.end >= total) continue;
    if (section.end > previous && section.end <= index) found = section;
  }
  if (!found || found.end - found.start < MIN_EXPLAIN_SECTION_WORDS) return null;
  return found;
}

/**
 * O que explicar na conclusao: a ultima secao, ou o texto inteiro quando ele
 * nao tem secoes. `start` e o inicio da parte que a rota de apontamentos
 * espera (0 para "todo o trecho lido").
 */
export function finishedPart(
  sections: TextSection[],
  total: number
): { start: number; title: string | null } | null {
  if (total < MIN_EXPLAIN_SECTION_WORDS) return null;
  const last = sections[sections.length - 1];
  if (!last) return { start: 0, title: null };
  if (last.end - last.start < MIN_EXPLAIN_SECTION_WORDS) return null;
  return { start: last.start, title: last.title };
}
