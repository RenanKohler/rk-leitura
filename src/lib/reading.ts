/**
 * Funcoes puras compartilhadas entre servidor e cliente.
 * Nao importar nada de servidor aqui.
 */
import { parseMarkdown, type BlockKind } from "@/lib/markdown";

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

/** Tipografia da area de leitura, em niveis em vez de pixels. */
export const MIN_FONT_SCALE = 1;
export const MAX_FONT_SCALE = 5;
export const MIN_LINE_HEIGHT = 1;
export const MAX_LINE_HEIGHT = 3;

export const FONT_FAMILIES = ["sans", "serif", "legivel"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export function asFontFamily(value: unknown): FontFamily {
  return FONT_FAMILIES.includes(value as FontFamily) ? (value as FontFamily) : "sans";
}

/** Variaveis CSS da area de leitura, a partir das preferencias. */
export function typographyVars(settings: {
  fontScale: number;
  fontFamily: FontFamily;
  lineHeightStep: number;
}): Record<string, string> {
  const scale = clamp(settings.fontScale, MIN_FONT_SCALE, MAX_FONT_SCALE);
  const leading = clamp(settings.lineHeightStep, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT);

  return {
    // 1rem a 1.5rem em cinco degraus.
    "--reader-size": `${(1 + (scale - 1) * 0.125).toFixed(3)}rem`,
    "--reader-leading": ["1.6", "1.85", "2.1"][leading - 1]!,
    "--reader-font": `var(--reader-font-${settings.fontFamily})`,
    // A pilha "legivel" pede folga entre letras; as outras nao.
    "--reader-tracking": settings.fontFamily === "legivel" ? "0.02em" : "normal",
  };
}

/**
 * Rampa de aquecimento: a leitura comeca mais devagar e chega a velocidade
 * cheia ao longo das primeiras palavras.
 *
 * Sem ela as primeiras frases passam antes de o olho se ajustar ao ritmo, o
 * que custa justamente a abertura do texto - a parte que orienta o resto.
 */
export const WARMUP_WORDS = 50;
export const WARMUP_START = 0.6;

/** Fracao da velocidade configurada a ser aplicada na posicao `wordsIntoRun`. */
export function warmupFactor(wordsIntoRun: number): number {
  if (wordsIntoRun >= WARMUP_WORDS) return 1;
  const progress = clamp(wordsIntoRun / WARMUP_WORDS, 0, 1);
  return WARMUP_START + (1 - WARMUP_START) * progress;
}

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

/**
 * Como o conteudo guardado deve ser lido. Texto simples e o padrao: os textos
 * anteriores ao Markdown mantem a contagem de palavras e, com ela, a posicao
 * salva e os destaques.
 */
export type TextFormat = "plain" | "markdown";

export function asTextFormat(value: unknown): TextFormat {
  return value === "markdown" ? "markdown" : "plain";
}

export function countWords(content: string, format: TextFormat = "plain"): number {
  if (format === "markdown") {
    return parseMarkdown(content).reduce((sum, block) => sum + block.words.length, 0);
  }
  return tokenize(content).length;
}

export interface Paragraph {
  /** Indice, no texto inteiro, da primeira palavra do paragrafo. */
  start: number;
  words: string[];
  /** Tipo do bloco em textos Markdown; ausente e paragrafo comum. */
  kind?: BlockKind;
  /** Numero do item em lista numerada. */
  marker?: string;
  /** Estilo de cada palavra (bits de STYLE), so em textos Markdown. */
  styles?: number[];
  /**
   * Recorte que comeca no meio do paragrafo (topo da pagina ou da janela da
   * rolagem): o inicio real ficou antes e nao recebe a marca de paragrafo.
   */
  continued?: boolean;
}

/**
 * Separa o texto em paragrafos e, ao mesmo tempo, na lista corrida de palavras
 * usada para indexar a posicao de leitura.
 *
 * O leitor precisa das duas visoes: a lista corrida da o ritmo e o progresso,
 * os paragrafos dao a forma na tela. Antes so existia a lista corrida, entao o
 * texto era exibido como um bloco unico - dialogo e narracao sem separacao.
 */
export function parseParagraphs(
  content: string,
  format: TextFormat = "plain"
): { words: string[]; paragraphs: Paragraph[] } {
  const words: string[] = [];
  const paragraphs: Paragraph[] = [];

  if (format === "markdown") {
    for (const block of parseMarkdown(content)) {
      paragraphs.push({
        start: words.length,
        words: block.words,
        kind: block.kind,
        ...(block.marker ? { marker: block.marker } : {}),
        styles: block.styles,
      });
      for (const word of block.words) words.push(word);
    }
    return { words, paragraphs };
  }

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
    slice.push({
      ...paragraph,
      start: paragraph.start + from,
      words: paragraph.words.slice(from, to),
      ...(paragraph.styles ? { styles: paragraph.styles.slice(from, to) } : {}),
      ...(from > 0 ? { continued: true } : {}),
    });
  }

  return slice;
}

/** Indice do paragrafo que contem a palavra `index` (busca binaria). */
function paragraphAt(paragraphs: Paragraph[], index: number): number {
  let low = 0;
  let high = paragraphs.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (paragraphs[middle]!.start <= index) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** A palavra `index` abre um paragrafo (ou titulo, item, citacao). */
export function startsParagraph(paragraphs: Paragraph[], index: number): boolean {
  if (paragraphs.length === 0) return false;
  return paragraphs[paragraphAt(paragraphs, index)]!.start === index;
}

/**
 * Tamanho do bloco que comeca em `index`: ate `size` palavras, sem atravessar
 * o fim do paragrafo. Assim o fim de um paragrafo e o comeco do seguinte
 * nunca aparecem juntos na mesma tela.
 */
export function chunkLength(paragraphs: Paragraph[], index: number, size: number): number {
  if (paragraphs.length === 0) return size;
  const paragraph = paragraphs[paragraphAt(paragraphs, index)]!;
  const remaining = paragraph.start + paragraph.words.length - index;
  return Math.max(1, Math.min(size, remaining));
}

/**
 * Milissegundos que cada bloco de palavras fica na tela.
 *
 * `speedFactor` existe para a rampa de aquecimento entrar sem estado escondido:
 * quem chama decide a fracao, a funcao continua pura e testavel.
 */
export function chunkDurationMs(
  wpm: number,
  wordsPerChunk: number,
  speedFactor = 1
): number {
  const safeWpm = clamp(wpm, MIN_WPM, MAX_WPM) * clamp(speedFactor, WARMUP_START, 1);
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

/**
 * Enfase no inicio das palavras.
 *
 * Aproximadamente a primeira metade das letras em negrito. A ideia e que o
 * olho reconheca a palavra pelo comeco, sem soletrar o resto; se ajuda ou nao
 * depende de quem le, e por isso e uma opcao e nao o padrao.
 */
export interface WordPart {
  text: string;
  bold: boolean;
}

/** Quantas letras iniciais recebem enfase. */
export function emphasisLength(word: string): number {
  // Conta so letras: pontuacao e aspas no inicio nao deveriam puxar o negrito
  // para dentro da palavra nem consumir a metade enfatizada.
  const letters = word.replace(/[^\p{L}\p{N}]/gu, "").length;
  if (letters <= 1) return letters;
  if (letters <= 3) return 1;
  return Math.ceil(letters / 2);
}

/** Divide a palavra entre a parte enfatizada e o resto. */
export function splitEmphasis(word: string, enabled: boolean): WordPart[] {
  if (!enabled) return [{ text: word, bold: false }];

  const target = emphasisLength(word);
  if (target === 0) return [{ text: word, bold: false }];

  let letters = 0;
  let cut = 0;
  for (const char of word) {
    cut += char.length;
    if (/[\p{L}\p{N}]/u.test(char)) letters += 1;
    if (letters >= target) break;
  }

  const head = word.slice(0, cut);
  const tail = word.slice(cut);
  return tail.length > 0
    ? [
        { text: head, bold: true },
        { text: tail, bold: false },
      ]
    : [{ text: head, bold: true }];
}
