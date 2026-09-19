/**
 * Destaques: trechos marcados durante a leitura.
 *
 * O intervalo e guardado por indice de palavra, no mesmo sistema do
 * `progressIndex`. E o que faz a marcacao sobreviver a mudanca de fonte, de
 * modo de leitura e de tamanho de tela: nada aqui depende de como o texto foi
 * quebrado em linhas ou paginas.
 *
 * Funcoes puras, compartilhadas entre servidor e cliente.
 */

import { countWords, tokenize } from "@/lib/reading";

export const MAX_NOTE_CHARS = 2_000;

/**
 * Teto de palavras por destaque.
 *
 * Sem ele, "selecionar tudo" viraria um destaque do texto inteiro - que nao
 * destaca nada e ainda esconde os outros embaixo.
 */
export const MAX_HIGHLIGHT_WORDS = 500;

/** Intervalo de palavras `[start, end)`. */
export interface Span {
  start: number;
  end: number;
}

export interface StoredHighlight extends Span {
  id: string;
  note: string | null;
}

/**
 * Ajusta um intervalo vindo de fora ao texto real.
 *
 * Aceita os extremos em qualquer ordem porque uma selecao de tela pode ser
 * feita de tras para frente.
 */
export function normalizeRange(
  start: unknown,
  end: unknown,
  totalWords: number
): Span | null {
  const first = Math.trunc(Number(start));
  const second = Math.trunc(Number(end));
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  const low = Math.max(0, Math.min(first, second));
  const high = Math.min(totalWords, Math.max(first, second));
  if (high <= low) return null;

  return { start: low, end: Math.min(high, low + MAX_HIGHLIGHT_WORDS) };
}

/**
 * Primeira palavra tocada por um corte de selecao, contando do inicio de
 * `text`.
 *
 * Quando o corte cai no meio de uma palavra, a palavra inteira entra: meia
 * palavra destacada seria um recorte que o leitor nao pediu e nao consegue
 * desfazer com precisao no toque.
 */
export function wordIndexAtStart(text: string, offset: number): number {
  const cut = clampOffset(text, offset);
  const before = countWords(text.slice(0, cut));
  return insideWord(text, cut) ? Math.max(0, before - 1) : before;
}

/** Primeira palavra depois do corte: o `end` exclusivo do intervalo. */
export function wordIndexAtEnd(text: string, offset: number): number {
  return countWords(text.slice(0, clampOffset(text, offset)));
}

function clampOffset(text: string, offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(text.length, Math.trunc(offset)));
}

/** Verdadeiro quando o corte cai entre duas letras da mesma palavra. */
function insideWord(text: string, cut: number): boolean {
  if (cut <= 0) return false;
  return !/\s/.test(text[cut - 1] ?? " ");
}

/** Fim de frase: pontuacao terminal, com aspas ou parenteses de fecho depois. */
const SENTENCE_END = /[.!?…][")'\]»”’]*$/;

/**
 * Frase que contem a palavra `index`.
 *
 * Serve ao modo Foco, onde nao ha o que selecionar: a unidade que o leitor
 * consegue apontar sem parar a leitura e a frase.
 */
export function sentenceRange(words: string[], index: number): Span | null {
  if (words.length === 0) return null;
  const position = Math.max(0, Math.min(words.length - 1, Math.trunc(index)));

  let start = position;
  while (start > 0 && !SENTENCE_END.test(words[start - 1]!)) start -= 1;

  let end = position;
  while (end < words.length && !SENTENCE_END.test(words[end]!)) end += 1;
  // `end` parou na palavra que fecha a frase; o intervalo e exclusivo.
  end = Math.min(words.length, end + 1);

  // Um paragrafo inteiro sem pontuacao terminal viraria um destaque gigante.
  if (end - start > MAX_HIGHLIGHT_WORDS) {
    start = Math.max(0, position - Math.floor(MAX_HIGHLIGHT_WORDS / 2));
    end = Math.min(words.length, start + MAX_HIGHLIGHT_WORDS);
  }

  return { start, end };
}

/** Trecho citado, reconstruido da lista de palavras. */
export function excerptOf(words: string[], start: number, end: number): string {
  return words.slice(Math.max(0, start), Math.max(0, end)).join(" ");
}

/**
 * Funde o novo destaque com os que ele encosta.
 *
 * Dois destaques sobrepostos nao teriam como ser pintados nem tocados sem
 * ambiguidade. Encostar conta como sobrepor: marcar a segunda metade de uma
 * frase ja marcada e continuar a mesma marcacao, nao criar outra.
 *
 * As notas dos absorvidos sao preservadas e juntadas - apagar o que o leitor
 * escreveu por causa de um gesto de marcacao seria perda silenciosa.
 */
export function absorb(
  existing: StoredHighlight[],
  incoming: Span
): { range: Span; absorbed: string[]; note: string | null } {
  const touching = existing
    .filter((item) => item.start <= incoming.end && item.end >= incoming.start)
    .sort((a, b) => a.start - b.start);

  if (touching.length === 0) {
    return { range: incoming, absorbed: [], note: null };
  }

  const range = {
    start: Math.min(incoming.start, ...touching.map((item) => item.start)),
    end: Math.max(incoming.end, ...touching.map((item) => item.end)),
  };

  const notes = touching
    .map((item) => item.note?.trim())
    .filter((note): note is string => Boolean(note));

  return {
    range,
    absorbed: touching.map((item) => item.id),
    note: notes.length > 0 ? notes.join("\n\n").slice(0, MAX_NOTE_CHARS) : null,
  };
}

/** Nota normalizada: vazia vira ausencia, e nao uma nota em branco. */
export function asNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, MAX_NOTE_CHARS) : null;
}

export interface ExportItem {
  start: number;
  excerpt: string;
  note: string | null;
}

/**
 * Markdown dos destaques, na ordem do texto.
 *
 * Formato pensado para colar em outra ferramenta de notas: citacao para o
 * trecho, paragrafo solto para o comentario de quem leu.
 */
export function toMarkdown(
  text: { title: string; sourceUrl: string | null },
  items: ExportItem[]
): string {
  const lines: string[] = [`# ${text.title}`, ""];

  if (text.sourceUrl) {
    lines.push(`Origem: <${text.sourceUrl}>`, "");
  }

  if (items.length === 0) {
    lines.push("_Nenhum destaque._", "");
    return lines.join("\n");
  }

  for (const item of [...items].sort((a, b) => a.start - b.start)) {
    lines.push(...quote(item.excerpt), "");
    if (item.note) lines.push(...item.note.split("\n"), "");
  }

  return lines.join("\n");
}

/** Cada linha do trecho vira uma linha de citacao, senao a citacao quebra. */
function quote(excerpt: string): string[] {
  const body = excerpt.split("\n");
  return body.map((line) => `> ${line}`.trimEnd());
}

/** Nome do arquivo baixado, derivado do titulo. */
export function exportFileName(title: string): string {
  const slug = tokenize(title)
    .join("-")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60);

  return `${slug || "destaques"}-destaques.md`;
}

/** Um pedaco de paragrafo: marcado (com `id`) ou nao (`id` nulo). */
export interface Segment extends Span {
  id: string | null;
  hasNote: boolean;
}

/**
 * Quebra um trecho do texto nos pedacos marcados e nao marcados.
 *
 * O modo Paginas desenha assim em vez de uma `<span>` por palavra: a regua que
 * mede a pagina monta texto corrido, e um paragrafo em centenas de elementos
 * so para pintar dois deles mudaria o que esta sendo medido. Sem destaque
 * algum, o resultado e um pedaco unico - exatamente o que existia antes.
 */
export function segmentsOf(
  start: number,
  end: number,
  marks: StoredHighlight[]
): Segment[] {
  const inside = marks
    .filter((mark) => mark.start < end && mark.end > start)
    .sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = start;

  for (const mark of inside) {
    const from = Math.max(start, mark.start);
    const to = Math.min(end, mark.end);
    if (from > cursor) segments.push({ start: cursor, end: from, id: null, hasNote: false });
    if (to > from) {
      segments.push({ start: from, end: to, id: mark.id, hasNote: Boolean(mark.note) });
    }
    cursor = Math.max(cursor, to);
  }

  if (cursor < end) segments.push({ start: cursor, end, id: null, hasNote: false });
  return segments;
}

/** Destaque que cobre a palavra `index`, se houver. */
export function markCovering(
  marks: StoredHighlight[],
  index: number
): StoredHighlight | null {
  return marks.find((mark) => mark.start <= index && index < mark.end) ?? null;
}
