/**
 * Funcoes puras compartilhadas entre servidor e cliente.
 * Nao importar nada de servidor aqui.
 */
import { parseMarkdown, type BlockKind } from "@/lib/markdown";
import { pauseOverhead } from "@/lib/pauses";

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
/** Nove degraus: 1rem a 2rem, o dobro do corpo base, como o zoom de 200%. */
export const MAX_FONT_SCALE = 9;
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

  const size = 1 + (scale - 1) * 0.125;
  return {
    // 1rem a 2rem em nove degraus.
    "--reader-size": `${size.toFixed(3)}rem`,
    // A palavra do Word Runner acompanha o tamanho escolhido, relativa ao
    // padrao (degrau 3, 1.25rem): no padrao ela fica como sempre foi.
    "--reader-scale": (size / 1.25).toFixed(3),
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
 * que custa justamente a abertura do texto - a parte que orienta o resto. O
 * olho se ajusta em poucas frases: com 50 palavras a rampa durava ~13 s a
 * 300 ppm e parecia lentidao, nao aquecimento; 25 cobre as duas primeiras
 * frases.
 */
export const WARMUP_WORDS = 25;
export const WARMUP_START = 0.6;

/** Pausa abaixo da qual retomar nao reaquece: o olho ainda esta no ritmo. */
export const WARMUP_SKIP_MS = 3_000;
/** Ate aqui a retomada reaquece de leve. */
export const WARMUP_SHORT_MS = 30_000;
/** Acima disso a retomada reaquece como uma abertura. */
export const WARMUP_LONG_MS = 120_000;
/** Fator inicial da retomada depois de uma pausa curta. */
export const WARMUP_SHORT_START = 0.85;

/**
 * Fator inicial da rampa conforme a pausa que antecede a leitura.
 *
 * Abrir o texto (sem pausa previa - `undefined`, ou 0, que e como o leitor
 * marca "ainda nao pausou") e voltar depois de mais de 2 minutos comecam em
 * 0,6. Uma pausa de 3 a 30 s comeca em 0,85; de 30 s a 2 min, o fator desce
 * de 0,85 a 0,6. Menos de 3 s nao tem rampa (1): tirar o dedo da tela por um
 * instante nao desfaz a adaptacao ao ritmo.
 */
export function warmupStart(pausedMs?: number | null): number {
  if (pausedMs === undefined || pausedMs === null || !Number.isFinite(pausedMs) || pausedMs <= 0) {
    return WARMUP_START;
  }
  if (pausedMs < WARMUP_SKIP_MS) return 1;
  if (pausedMs <= WARMUP_SHORT_MS) return WARMUP_SHORT_START;
  if (pausedMs >= WARMUP_LONG_MS) return WARMUP_START;
  const progress = (pausedMs - WARMUP_SHORT_MS) / (WARMUP_LONG_MS - WARMUP_SHORT_MS);
  return WARMUP_SHORT_START + (WARMUP_START - WARMUP_SHORT_START) * progress;
}

/**
 * Fracao da velocidade configurada a ser aplicada na posicao `wordsIntoRun`,
 * subindo linearmente de `start` a 1 ao longo de `WARMUP_WORDS` palavras.
 * Posicao negativa (o leitor voltou para antes de onde a rampa comecou) conta
 * como o inicio da rampa.
 */
export function warmupFactor(wordsIntoRun: number, start: number = WARMUP_START): number {
  const from = clamp(start, WARMUP_START, 1);
  if (wordsIntoRun >= WARMUP_WORDS || from >= 1) return 1;
  const progress = clamp(wordsIntoRun / WARMUP_WORDS, 0, 1);
  return from + (1 - from) * progress;
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
 * Palavra composta por hifen ("guarda-chuva", "e-mail").
 *
 * Na tela ela nao pode quebrar no hifen: "guarda-" no fim de uma linha e
 * "chuva" no comeco da outra se leem como duas palavras. Acima de 40
 * caracteres a quebra volta a ser permitida, para a palavra nao estourar a
 * largura da tela.
 */
export function isCompound(word: string): boolean {
  return word.length <= 40 && /[\p{L}\p{N}][-\u2010][\p{L}\p{N}]/u.test(word);
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

/** Intervalo [start, end) do paragrafo que contem a palavra `index`. */
export function paragraphRange(
  paragraphs: Paragraph[],
  index: number,
  total: number
): { start: number; end: number } {
  if (paragraphs.length === 0) return { start: 0, end: total };
  const paragraph = paragraphs[paragraphAt(paragraphs, index)]!;
  return { start: paragraph.start, end: paragraph.start + paragraph.words.length };
}

/**
 * Inicio estavel da janela renderizada da rolagem para uma posicao alvo.
 *
 * Se o inicio acompanhasse a leitura palavra a palavra, o paragrafo do topo
 * perderia uma palavra a cada passo e se redistribuiria o tempo todo. O
 * inicio so avanca em paragrafos inteiros e, dentro de um paragrafo longo,
 * em saltos de `step` palavras.
 */
export function windowStart(paragraphs: Paragraph[], target: number, step: number): number {
  if (target <= 0 || paragraphs.length === 0) return 0;
  const paragraphStart = paragraphs[paragraphAt(paragraphs, target)]!.start;
  return Math.max(paragraphStart, Math.floor(target / step) * step);
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

/** Parte de pontuacao no inicio e no fim de uma palavra (aspas, parenteses...). */
const EDGE = /[^\p{L}\p{N}]/u;

/** Posicao do ponto de fixacao dentro do nucleo de letras, por tamanho. */
function coreOrp(length: number): number {
  if (length <= 1) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  if (length <= 13) return 3;
  return 4;
}

/**
 * Ponto otimo de reconhecimento: a letra em que o olho se fixa para
 * identificar a palavra sem varrer. Fica levemente a esquerda do centro.
 *
 * A pontuacao nao conta: em `"casa` o pivo e o "a" de casa, nao o "c" - com a
 * aspa no calculo a palavra ficava deslocada uma casa. O indice e em code
 * points da forma NFC (a de `Array.from(word.normalize("NFC"))`), para um
 * acento decomposto nao ser partido da letra; `orpParts` ja devolve os
 * pedacos prontos.
 */
export function orpIndex(word: string): number {
  const chars = Array.from(word.normalize("NFC"));
  let lead = 0;
  while (lead < chars.length && EDGE.test(chars[lead]!)) lead += 1;
  if (lead === chars.length) return 0;
  let trail = 0;
  while (trail < chars.length - lead && EDGE.test(chars[chars.length - 1 - trail]!)) trail += 1;
  return lead + coreOrp(chars.length - lead - trail);
}

/** A palavra (em NFC) partida em antes do pivo, o pivo e depois dele. */
export function orpParts(word: string): { before: string; pivot: string; after: string } {
  const chars = Array.from(word.normalize("NFC"));
  const index = orpIndex(word);
  return {
    before: chars.slice(0, index).join(""),
    pivot: chars[index] ?? "",
    after: chars.slice(index + 1).join(""),
  };
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

/**
 * Minutos de relogio para ler `wordCount` palavras.
 *
 * O ppm e o das palavras, sem as pausas de pontuacao (e assim que o leitor
 * grava as sessoes); com o ritmo dinamico ligado a tela ainda pausa em
 * virgulas e fins de frase, entao o tempo leva o acrescimo medio delas.
 */
export function estimatedMinutes(wordCount: number, wpm: number, adaptive = true): number {
  const safeWpm = clamp(wpm, MIN_WPM, MAX_WPM);
  const factor = adaptive ? pauseOverhead(safeWpm) : 1;
  return Math.max(1, Math.round((wordCount / safeWpm) * factor));
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
