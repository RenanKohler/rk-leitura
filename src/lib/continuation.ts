/**
 * Regras da continuacao de um texto em partes.
 *
 * Funcoes puras, fora da rota: sao elas que decidem se a parte recebida e
 * mesmo nova, e essa decisao precisa ser verificavel sem rede nem banco.
 */

/** A URL da proxima parte: a mesma origem com `?page=` trocado. */
export function buildPageUrl(sourceUrl: string, page: number): string | null {
  try {
    const url = new URL(sourceUrl);
    url.searchParams.set("page", String(page));
    return url.toString();
  } catch {
    return null;
  }
}

export const REPEAT_THRESHOLD = 0.9;
export const MIN_COMPARABLE_CHARS = 40;

/**
 * Mede a fracao de paragrafos da parte recebida que ja estao no texto.
 *
 * Comparar apenas a abertura falharia nos dois sentidos: uma origem que repete
 * o primeiro paragrafo em toda pagina seria lida como fim do conto, e uma que
 * muda so o inicio passaria como parte nova. Paragrafos curtos ficam de fora
 * da conta porque falas de dialogo se repetem naturalmente.
 */
export function alreadyPresent(existing: string, incoming: string): boolean {
  const known = new Set(comparableBlocks(existing));
  const blocks = comparableBlocks(incoming);
  if (blocks.length === 0) return false;

  const repeated = blocks.filter((block) => known.has(block)).length;
  return repeated / blocks.length >= REPEAT_THRESHOLD;
}

function comparableBlocks(content: string): string[] {
  return content
    .split(/\n+/)
    .map(normalize)
    .filter((block) => block.length >= MIN_COMPARABLE_CHARS);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
