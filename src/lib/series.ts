/**
 * Series de capitulos.
 *
 * Um conto publicado em partes chega a biblioteca como textos soltos: a
 * continuacao (US-23) avanca `?page=` dentro de um capitulo, mas nao sabe que
 * `-ch-02` e a continuacao de `-ch-01`. Aqui mora a leitura desse padrao.
 *
 * A deteccao e heuristica e assumidamente parcial: o padrao do Literotica e
 * confiavel, outras origens nao sao. Quando nada casa, o texto fica solto na
 * biblioteca - que e o comportamento de antes, nao um erro.
 *
 * Funcoes puras, compartilhadas entre servidor e cliente.
 */

import { foldForSearch } from "@/lib/text-filter";

/** Capitulo alem disto quase certamente e um numero que nao e capitulo. */
export const MAX_CHAPTER = 999;

export interface SeriesMatch {
  /** Identidade da historia, compartilhada por todos os capitulos. */
  key: string;
  /** Numero do capitulo dentro da serie. */
  chapter: number;
  /** Titulo sem a marca de capitulo, para nomear a serie. */
  title: string;
}

/**
 * Marca de capitulo no fim do slug: `-ch-02`, `-ch02`, `-chapter-2`,
 * `-parte-3`, `-pt-3`.
 */
const SLUG_CHAPTER = /-(?:ch|chapter|cap|capitulo|pt|parte|part)-?(\d{1,3})$/i;

/**
 * Marca de capitulo no fim do titulo: "Ch. 02", "Capitulo 3", "Parte II".
 *
 * Exige separador antes para nao confundir com um numero que faz parte do
 * nome ("1984", "Apollo 11").
 */
const TITLE_CHAPTER =
  /[\s\-–—:,(]+(?:ch|chapter|cap|capitulo|capítulo|pt|parte|part)\.?\s*(\d{1,3}|[ivxlcdm]+)\)?\s*$/i;

/**
 * Le a marca de capitulo de um texto.
 *
 * O endereco tem prioridade sobre o titulo: o slug e gerado pela origem e
 * segue um padrao, enquanto o titulo e escrito por uma pessoa e varia.
 */
export function detectSeries(title: string, sourceUrl: string | null): SeriesMatch | null {
  return fromUrl(title, sourceUrl) ?? fromTitle(title);
}

function fromUrl(title: string, sourceUrl: string | null): SeriesMatch | null {
  if (!sourceUrl) return null;

  let slug: string;
  try {
    slug = new URL(sourceUrl).pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  } catch {
    return null;
  }

  const match = SLUG_CHAPTER.exec(slug);
  if (!match) return null;

  const chapter = Number(match[1]);
  if (!validChapter(chapter)) return null;

  // A chave sai do slug sem a marca: e o que todos os capitulos tem em comum.
  const stem = slug.slice(0, match.index);
  if (stem.length === 0) return null;

  return { key: `url:${stem.toLowerCase()}`, chapter, title: cleanTitle(title) };
}

function fromTitle(title: string): SeriesMatch | null {
  const match = TITLE_CHAPTER.exec(title);
  if (!match) return null;

  const chapter = romanOrNumber(match[1]!);
  if (chapter === null || !validChapter(chapter)) return null;

  const stem = title.slice(0, match.index).trim();
  if (stem.length === 0) return null;

  return { key: seriesKeyFor(stem), chapter, title: stem };
}

/**
 * Chave de serie derivada de um titulo.
 *
 * Usada tambem pela importacao de EPUB, onde a sequencia e conhecida de
 * antemao e nao precisa ser adivinhada a partir do nome do capitulo - o que
 * permite ao capitulo manter o proprio titulo ("A chegada") em vez de virar
 * "Livro Ch. 01" so para a deteccao funcionar.
 */
export function seriesKeyFor(title: string): string {
  return `titulo:${foldForSearch(title)}`;
}

/** Titulo sem a marca de capitulo, quando ela esta la. */
export function cleanTitle(title: string): string {
  const match = TITLE_CHAPTER.exec(title);
  if (!match) return title.trim();

  const stem = title.slice(0, match.index).trim();
  return stem.length > 0 ? stem : title.trim();
}

function validChapter(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_CHAPTER;
}

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

/** Aceita "12" e "XII"; qualquer outra coisa nao e capitulo. */
function romanOrNumber(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);

  const letters = raw.toLowerCase();
  if (!/^[ivxlcdm]+$/.test(letters)) return null;

  let total = 0;
  for (let index = 0; index < letters.length; index += 1) {
    const value = ROMAN[letters[index]!]!;
    const next = ROMAN[letters[index + 1] ?? ""] ?? 0;
    total += value < next ? -value : value;
  }

  return total > 0 ? total : null;
}

/**
 * Endereco do proximo capitulo, quando o padrao esta no slug.
 *
 * Usado para importar o capitulo seguinte direto da origem, sem que o leitor
 * precise procurar o link. Um endereco cujo padrao esta so no titulo nao tem
 * como ser adivinhado - nesse caso nao ha o que oferecer.
 */
export function nextChapterUrl(sourceUrl: string | null, chapter: number): string | null {
  if (!sourceUrl) return null;

  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }

  const parts = url.pathname.replace(/\/+$/, "").split("/");
  const slug = parts.pop() ?? "";
  const match = SLUG_CHAPTER.exec(slug);
  if (!match) return null;

  const next = chapter + 1;
  if (!validChapter(next)) return null;

  // Preserva a forma da marca ("-ch-02" continua com dois digitos).
  const width = match[1]!.length;
  const marker = slug.slice(match.index).replace(match[1]!, String(next).padStart(width, "0"));

  url.pathname = [...parts, slug.slice(0, match.index) + marker].join("/");
  // A pagina dentro do capitulo comeca do zero no capitulo novo.
  url.searchParams.delete("page");
  return url.toString();
}

/** Rotulo do progresso na serie: "cap. 3 de 7". */
export function seriesProgress(current: number, total: number): string {
  return `cap. ${current} de ${total}`;
}
