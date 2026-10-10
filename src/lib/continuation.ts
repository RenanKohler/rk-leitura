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

/** Paginas buscadas, no maximo, numa importacao de todas as paginas. */
export const MAX_IMPORT_PAGES = 50;
/** Teto de tempo da importacao de todas as paginas: o resto fica para "Continuar". */
export const ALL_PAGES_BUDGET_MS = 45_000;
/** Tamanho maximo do texto, o mesmo da criacao e da continuacao. */
export const MAX_TEXT_CHARS = 400_000;
/** Ultima parte que um texto pode ter, a mesma da continuacao. */
export const MAX_SOURCE_PAGE = 200;

export type PartResult =
  | { status: "appended"; content: string }
  | { status: "end" | "unavailable" | "no-source"; message: string };

export interface CollectedPages {
  content: string;
  /** Primeira e ultima pagina que entraram no texto. */
  firstPage: number;
  lastPage: number;
  /** Chegou ao fim do texto; falso quando parou por limite ou falha. */
  complete: boolean;
  /** Por que parou antes do fim; vazio quando `complete`. */
  stopMessage: string;
}

/**
 * Junta as partes seguintes a primeira, ate a origem indicar o fim.
 *
 * A busca de cada parte e injetada, para a regra de parada poder ser testada
 * sem rede: fim da origem encerra completo; falha, teto de paginas, tamanho
 * ou tempo encerram incompleto, com o que ja veio guardado e o motivo.
 */
export async function collectPages(
  first: { content: string; page: number },
  fetchPart: (page: number, existing: string) => Promise<PartResult>,
  options: { now?: () => number; budgetMs?: number; maxPages?: number } = {}
): Promise<CollectedPages> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? ALL_PAGES_BUDGET_MS);
  const maxPages = options.maxPages ?? MAX_IMPORT_PAGES;

  let content = first.content.trim();
  let lastPage = first.page;
  const stop = (stopMessage: string, complete = false): CollectedPages => ({
    content,
    firstPage: first.page,
    lastPage,
    complete,
    stopMessage: complete ? "" : stopMessage,
  });

  for (;;) {
    if (lastPage - first.page + 1 >= maxPages) {
      return stop(`Parei em ${maxPages} páginas, o máximo de uma importação.`);
    }
    if (lastPage >= MAX_SOURCE_PAGE) return stop("Limite de partes atingido para este texto.");
    if (content.length >= MAX_TEXT_CHARS) return stop("O texto atingiu o tamanho máximo.");
    if (now() >= deadline) return stop("A busca das páginas passou do tempo.");

    const part = await fetchPart(lastPage + 1, content);
    if (part.status !== "appended") return stop(part.message, part.status === "end");

    content = `${content}\n\n${part.content.trim()}`.slice(0, MAX_TEXT_CHARS);
    lastPage += 1;
  }
}
