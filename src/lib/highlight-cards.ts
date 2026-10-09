/**
 * Cartoes de revisao gerados a partir dos destaques (US-150). Funcoes puras,
 * usadas na rota, na tela de destaques e nos testes.
 *
 * Como na sintese (US-140), so os trechos destacados e as notas vao ao
 * modelo, numerados na ordem da leitura. O modelo devolve no maximo um cartao
 * por destaque, citando o numero; e por ele que o cartao volta ao destaque de
 * origem. A pergunta e a resposta saem so do trecho e da nota.
 */

/** Com menos que isso o botao fica desativado. */
export const MIN_HIGHLIGHTS_FOR_CARDS = 3;

/** Cartoes por pedido: um por destaque, ate este teto. */
export const MAX_CARDS = 20;

/** Tetos de tamanho, para o cartao caber na tela de revisao. */
export const MAX_CARD_PROMPT_CHARS = 300;
export const MAX_CARD_ANSWER_CHARS = 500;

/** Teto do que vai ao modelo, como na sintese. */
export const MAX_CARDS_INPUT_CHARS = 60_000;

export interface CardHighlight {
  id: string;
  start: number;
  excerpt: string;
  note: string | null;
}

/** Um cartao ligado ao destaque de origem. */
export interface HighlightCardDraft {
  highlightId: string;
  prompt: string;
  answer: string;
}

function ordered<T extends { start: number; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/**
 * Pedido ao modelo: os destaques numerados, cada um com a nota. Vao no
 * maximo `MAX_CARDS` destaques - os primeiros na ordem da leitura - e so ate o
 * teto de caracteres. Devolve tambem os ids na ordem dos numeros.
 */
export function cardsPrompt(
  title: string,
  items: CardHighlight[]
): { prompt: string; ids: string[]; words: number } {
  const blocks: string[] = [];
  const ids: string[] = [];
  let used = 0;
  // Palavras do leitor que saem do app: trechos e notas, sem os marcadores.
  let words = 0;
  for (const item of ordered(items)) {
    if (ids.length >= MAX_CARDS) break;
    const excerpt = item.excerpt.replace(/\s+/g, " ").trim();
    const note = item.note?.replace(/\s+/g, " ").trim();
    const block = `[${ids.length + 1}] ${excerpt}${note ? `\nNota do leitor: ${note}` : ""}`;
    if (blocks.length > 0 && used + block.length > MAX_CARDS_INPUT_CHARS) break;
    blocks.push(block);
    ids.push(item.id);
    used += block.length;
    words += wordCount(excerpt) + wordCount(note ?? "");
  }
  return {
    prompt: `Texto: ${title}\n\nDestaques, na ordem da leitura:\n\n${blocks.join("\n\n")}`,
    ids,
    words,
  };
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Cartoes validos da resposta: numero dentro da faixa, pergunta e resposta
 * nao vazias, um so por destaque (o primeiro vale) e no maximo `MAX_CARDS`.
 * Ficam na ordem dos destaques.
 */
export function cleanCards(raw: unknown, ids: string[]): HighlightCardDraft[] {
  const list =
    raw && typeof raw === "object" && Array.isArray((raw as { cards?: unknown }).cards)
      ? ((raw as { cards: unknown[] }).cards as unknown[])
      : [];
  const byNumber = new Map<number, HighlightCardDraft>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const number = Number(record.highlight);
    if (!Number.isInteger(number) || number < 1 || number > ids.length) continue;
    if (byNumber.has(number)) continue;
    const prompt = clean(record.prompt, MAX_CARD_PROMPT_CHARS);
    const answer = clean(record.answer, MAX_CARD_ANSWER_CHARS);
    if (!prompt || !answer) continue;
    byNumber.set(number, { highlightId: ids[number - 1]!, prompt, answer });
  }
  return [...byNumber.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, MAX_CARDS)
    .map(([, card]) => card);
}

/**
 * Cartoes enviados pela tela para salvar, depois da edicao. Descartados nao
 * vem; um destaque repetido vale uma vez; pergunta ou resposta vazia e
 * recusada (null) em vez de virar cartao pela metade.
 */
export function parseCardEdits(raw: unknown): HighlightCardDraft[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CARDS) return null;
  const seen = new Set<string>();
  const cards: HighlightCardDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const highlightId = typeof record.highlightId === "string" ? record.highlightId : null;
    const prompt = clean(record.prompt, MAX_CARD_PROMPT_CHARS);
    const answer = clean(record.answer, MAX_CARD_ANSWER_CHARS);
    if (!highlightId || !prompt || !answer) return null;
    if (seen.has(highlightId)) continue;
    seen.add(highlightId);
    cards.push({ highlightId, prompt, answer });
  }
  return cards;
}
