/**
 * Sintese dos destaques de um texto (US-140). Funcoes puras, usadas na rota,
 * na pagina de destaques e na exportacao.
 *
 * So os trechos destacados e as notas vao ao modelo, numerados na ordem da
 * leitura - a mesma da lista na tela -, e a sintese cita esses numeros entre
 * colchetes. A impressao do conjunto de destaques fica guardada junto: quando
 * um destaque entra, sai ou muda de nota, ela deixa de bater e a sintese
 * aparece como desatualizada.
 */

/** Com menos que isso nao ha o que sintetizar: a lista ja e a sintese. */
export const MIN_HIGHLIGHTS_FOR_SYNTHESIS = 3;

export const MAX_SYNTHESIS_WORDS = 150;

/** Teto do que vai ao modelo: os destaques depois dele ficam de fora. */
export const MAX_SYNTHESIS_INPUT_CHARS = 60_000;

export interface SynthesisHighlight {
  id: string;
  start: number;
  end: number;
  excerpt: string;
  note: string | null;
}

/** O que fica guardado em `ai_results` (tipo `sintese`). */
export interface StoredSynthesis {
  synthesis: string;
  /** Numeros dos destaques citados, em ordem. */
  cited: number[];
  /** Impressao do conjunto de destaques usado. */
  fingerprint: string;
  /** Quantos destaques havia. */
  count: number;
  createdAt: string;
}

function ordered<T extends { start: number; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/**
 * Impressao do conjunto de destaques: id, intervalo e nota de cada um, na
 * ordem do texto. FNV-1a de 32 bits, para rodar igual no servidor e na tela.
 */
export function highlightsFingerprint(
  items: Pick<SynthesisHighlight, "id" | "start" | "end" | "note">[]
): string {
  const source = ordered(items)
    .map((item) => `${item.id}:${item.start}:${item.end}:${item.note ?? ""}`)
    .join("\n");
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${items.length}-${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Pedido ao modelo: os destaques numerados, cada um com a nota de quem leu.
 * Devolve tambem quantos couberam no teto.
 */
export function synthesisPrompt(
  title: string,
  items: SynthesisHighlight[]
): { prompt: string; included: number } {
  const blocks: string[] = [];
  let used = 0;
  for (const [index, item] of ordered(items).entries()) {
    const note = item.note ? `\nNota do leitor: ${item.note}` : "";
    const block = `[${index + 1}] ${item.excerpt.replace(/\s+/g, " ").trim()}${note}`;
    if (blocks.length > 0 && used + block.length > MAX_SYNTHESIS_INPUT_CHARS) break;
    blocks.push(block);
    used += block.length;
  }
  return {
    prompt: `Texto: ${title}\n\nDestaques, na ordem da leitura:\n\n${blocks.join("\n\n")}`,
    included: blocks.length,
  };
}

/**
 * Limpa a sintese devolvida: espacos, citacoes fora da faixa e o teto de
 * palavras. Devolve null quando nao sobra texto.
 */
export function cleanSynthesis(
  raw: unknown,
  count: number
): { synthesis: string; cited: number[] } | null {
  if (typeof raw !== "string") return null;

  // "[1, 3]" e "[1][3]" viram citacoes avulsas; numeros que nao existem saem.
  const normalized = raw
    .replace(/\s+/g, " ")
    .replace(/\[(\s*\d+\s*(?:[,;]\s*\d+\s*)+)\]/g, (_whole, list: string) =>
      list
        .split(/[,;]/)
        .map((part) => `[${part.trim()}]`)
        .join("")
    )
    .replace(/\[(\d+)\]/g, (whole, number: string) => {
      const value = Number(number);
      return value >= 1 && value <= count ? whole : "";
    })
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();

  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 0) return null;
  const synthesis =
    words.length > MAX_SYNTHESIS_WORDS
      ? `${words.slice(0, MAX_SYNTHESIS_WORDS).join(" ").replace(/[.,;:]$/, "")}…`
      : words.join(" ");

  const cited = [...new Set([...synthesis.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])))]
    .sort((a, b) => a - b);
  return { synthesis, cited };
}

/** A sintese guardada ainda corresponde aos destaques de agora? */
export function isSynthesisStale(
  stored: Pick<StoredSynthesis, "fingerprint">,
  items: Pick<SynthesisHighlight, "id" | "start" | "end" | "note">[]
): boolean {
  return stored.fingerprint !== highlightsFingerprint(items);
}

/** Leitura defensiva do que esta no banco. */
export function asStoredSynthesis(payload: unknown): StoredSynthesis | null {
  if (!payload || typeof payload !== "object") return null;
  const item = payload as Record<string, unknown>;
  if (typeof item.synthesis !== "string" || typeof item.fingerprint !== "string") return null;
  return {
    synthesis: item.synthesis,
    fingerprint: item.fingerprint,
    cited: Array.isArray(item.cited) ? item.cited.filter((n): n is number => typeof n === "number") : [],
    count: typeof item.count === "number" ? item.count : 0,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
  };
}
