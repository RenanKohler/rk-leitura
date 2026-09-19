/**
 * Funcoes puras compartilhadas entre servidor e cliente.
 * Nao importar nada de servidor aqui.
 */

export const MIN_WPM = 100;
export const MAX_WPM = 1200;
export const MIN_CHUNK = 1;
export const MAX_CHUNK = 6;
/**
 * Intensidade do destaque, em fracao. O minimo deixa o trecho perceptivel sem
 * pesar; acima do maximo o fundo cobre a palavra e a leitura piora.
 */
export const MIN_HIGHLIGHT = 0.1;
export const MAX_HIGHLIGHT = 0.8;

/**
 * rsvp  - uma palavra por vez no centro da tela
 * flow  - texto corrido com rolagem e destaque do trecho atual
 * page  - paginado, uma tela cheia por vez, sem rolagem
 */
export type ReadingMode = "rsvp" | "flow" | "page";

/**
 * Divide o texto em palavras preservando acentuacao e pontuacao.
 * A versao anterior aplicava /[^a-zA-Z0-9'-]/ e apagava todo acento -
 * "atencao" virava "ateno" em qualquer texto em portugues.
 */
export function tokenize(content: string): string[] {
  return content
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function countWords(content: string): number {
  return tokenize(content).length;
}

export interface Paragraph {
  /** Indice, no texto inteiro, da primeira palavra do paragrafo. */
  start: number;
  words: string[];
}

/**
 * Separa o texto em paragrafos e, ao mesmo tempo, na lista corrida de palavras
 * usada para indexar a posicao de leitura.
 *
 * O leitor precisa das duas visoes: a lista corrida da o ritmo e o progresso,
 * os paragrafos dao a forma na tela. Antes so existia a lista corrida, entao o
 * texto era exibido como um bloco unico - dialogo e narracao sem separacao.
 */
export function parseParagraphs(content: string): { words: string[]; paragraphs: Paragraph[] } {
  const words: string[] = [];
  const paragraphs: Paragraph[] = [];

  for (const block of content.split(/\n+/)) {
    const blockWords = block
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    if (blockWords.length === 0) continue;

    paragraphs.push({ start: words.length, words: blockWords });
    for (const word of blockWords) words.push(word);
  }

  return { words, paragraphs };
}

/** Recorte dos paragrafos que cobrem o intervalo de palavras [start, end). */
export function sliceParagraphs(
  paragraphs: Paragraph[],
  start: number,
  end: number
): Paragraph[] {
  const slice: Paragraph[] = [];

  for (const paragraph of paragraphs) {
    const paragraphEnd = paragraph.start + paragraph.words.length;
    if (paragraphEnd <= start) continue;
    if (paragraph.start >= end) break;

    const from = Math.max(start, paragraph.start) - paragraph.start;
    const to = Math.min(end, paragraphEnd) - paragraph.start;
    slice.push({ start: paragraph.start + from, words: paragraph.words.slice(from, to) });
  }

  return slice;
}

/** Milissegundos que cada bloco de palavras fica na tela. */
export function chunkDurationMs(wpm: number, wordsPerChunk: number): number {
  const safeWpm = clamp(wpm, MIN_WPM, MAX_WPM);
  const safeChunk = clamp(wordsPerChunk, MIN_CHUNK, MAX_CHUNK);
  return (60_000 / safeWpm) * safeChunk;
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Ponto otimo de reconhecimento: a letra em que o olho se fixa para
 * identificar a palavra sem varrer. Fica levemente a esquerda do centro.
 */
export function orpIndex(word: string): number {
  const length = word.length;
  if (length <= 1) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  return 3;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}min`;
  if (minutes > 0) return `${minutes}min ${seconds.toString().padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function estimatedMinutes(wordCount: number, wpm: number): number {
  return Math.max(1, Math.round(wordCount / clamp(wpm, MIN_WPM, MAX_WPM)));
}

export function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatRelativeDay(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const today = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);

  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) return `${diffDays} dias atras`;
  return formatDate(date);
}
