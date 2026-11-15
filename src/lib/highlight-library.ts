/**
 * "Destaques e notas" (US-224): os destaques de todos os textos num lugar so.
 *
 * Aqui ficam as regras puras da tela e da exportacao: o trecho de cada
 * destaque, a dobra da busca, o filtro, o agrupamento por texto, os rotulos
 * de contagem e o Markdown de tudo. As consultas ficam em
 * `highlight-library-queries.ts`.
 *
 * Funcoes puras, compartilhadas entre servidor e cliente.
 */

import { asTimezone, todayIn } from "@/lib/goals";
import { excerptLines, excerptOf, NO_HIGHLIGHTS_LINE, originLine } from "@/lib/highlights";
import { searchKey } from "@/lib/navigation";
import { asTextFormat, formatNumber, parseParagraphs } from "@/lib/reading";
import type { HighlightExportText, LibraryHighlight, LibraryHighlightText } from "@/lib/types";

/**
 * Teto da tela: os destaques mais recentes da conta. Cada destaque custa o
 * trecho no HTML, e a lista inteira e filtrada no aparelho a cada letra
 * digitada. Acima do teto a tela avisa (`truncationNotice`); nunca corta em
 * silencio.
 */
export const HIGHLIGHT_LIBRARY_LIMIT = 2_000;

/**
 * Teto da exportacao, so por seguranca: o arquivo e montado inteiro na
 * memoria do servidor antes de sair. E alto de proposito (dez vezes o da
 * tela) e o proprio arquivo avisa quando corta.
 */
export const HIGHLIGHT_EXPORT_LIMIT = 20_000;

/**
 * Quantos destaques a tela desenha de cada vez. A busca e a contagem valem
 * para todos os carregados; so o desenho e por partes, com "Mostrar mais",
 * para o celular nao montar dois mil cartoes de uma vez.
 */
export const HIGHLIGHT_PAGE_SIZE = 60;

/** Titulo da tela e da primeira linha do arquivo exportado. */
export const HIGHLIGHT_LIBRARY_TITLE = "Destaques e notas";

/* --- trecho ----------------------------------------------------------------- */

/** Um destaque como vem do banco, ainda sem o trecho. */
export interface HighlightRow {
  id: string;
  textId: string;
  start: number;
  end: number;
  note: string | null;
  reviewOff: boolean;
  createdAt: string;
}

/** Conteudo de um texto e como ele e lido. */
export interface TextSource {
  id: string;
  content: string;
  format: string;
}

/**
 * Poe o trecho em cada destaque.
 *
 * O trecho nao e guardado: sai do conteudo pelos indices de palavra. As
 * palavras de cada texto sao separadas uma vez so, e com a regra de
 * `loadHighlights` (`parseParagraphs` com o formato do texto; em Markdown a
 * separacao e outra), para o trecho sair identico ao da tela do texto.
 *
 * Destaque cujo texto nao veio (apagado entre uma consulta e a outra) fica
 * de fora: sem o conteudo nao ha trecho a mostrar.
 */
export function withExcerpts(rows: HighlightRow[], sources: TextSource[]): LibraryHighlight[] {
  const wordsByText = new Map<string, string[]>();
  for (const source of sources) {
    wordsByText.set(source.id, parseParagraphs(source.content, asTextFormat(source.format)).words);
  }

  const items: LibraryHighlight[] = [];
  for (const row of rows) {
    const words = wordsByText.get(row.textId);
    if (!words) continue;
    items.push({
      id: row.id,
      textId: row.textId,
      start: row.start,
      end: row.end,
      excerpt: excerptOf(words, row.start, row.end),
      note: row.note,
      reviewOff: row.reviewOff,
      createdAt: row.createdAt,
    });
  }
  return items;
}

/* --- busca e filtro ---------------------------------------------------------- */

/**
 * Forma comparavel de um texto corrido: cada palavra na chave da busca do
 * leitor (`searchKey`: minuscula, sem acento e sem pontuacao), com um espaco
 * entre elas.
 *
 * Assim "memoria de trabalho" acha "Memória de trabalho," e a virgula no meio
 * da frase nao impede o resultado. A comparacao e por pedaco do texto
 * dobrado, entao acha enquanto se digita ("memor") e tambem no meio da
 * palavra, como a busca da biblioteca.
 */
export function foldText(value: string): string {
  return value.split(/\s+/).map(searchKey).filter(Boolean).join(" ");
}

/** Filtro em chips da tela. */
export type HighlightScope = "todos" | "com-nota";

/** Um destaque com o texto em que a busca procura, ja dobrado. */
export interface SearchEntry {
  item: LibraryHighlight;
  haystack: string;
}

/**
 * Separa os campos no texto dobrado. O termo buscado nunca tem quebra de
 * linha, entao ele nao casa metade no fim do trecho e metade no comeco da nota.
 */
const FIELD_BREAK = "\n";

/**
 * Prepara a busca: trecho, nota e titulo do texto de cada destaque, dobrados
 * uma vez. Dobrar a cada letra digitada custaria a lista inteira de novo.
 */
export function searchIndex(items: LibraryHighlight[], texts: LibraryHighlightText[]): SearchEntry[] {
  const titles = new Map(texts.map((text) => [text.id, foldText(text.title)]));
  return items.map((item) => ({
    item,
    haystack: [
      foldText(item.excerpt),
      foldText(item.note ?? ""),
      titles.get(item.textId) ?? "",
    ].join(FIELD_BREAK),
  }));
}

/**
 * Destaques que passam pela busca e pelo filtro, na ordem em que vieram.
 *
 * A busca procura no trecho, na nota e no titulo do texto; "com nota" deixa
 * so os anotados. Busca vazia (ou so com pontuacao) nao filtra.
 */
export function filterHighlights(
  index: SearchEntry[],
  query: string,
  scope: HighlightScope
): LibraryHighlight[] {
  const needle = foldText(query);
  const matched: LibraryHighlight[] = [];
  for (const entry of index) {
    if (scope === "com-nota" && !entry.item.note) continue;
    if (needle && !entry.haystack.includes(needle)) continue;
    matched.push(entry.item);
  }
  return matched;
}

/* --- agrupamento -------------------------------------------------------------- */

/** Os destaques de um texto, como a tela e o arquivo os mostram. */
export interface HighlightGroup<T extends LibraryHighlightText = LibraryHighlightText> {
  text: T;
  /** Destaques do grupo, na ordem do texto. */
  items: LibraryHighlight[];
  /** Quantos o grupo tem; maior que `items.length` enquanto a tela nao desenhou todos. */
  count: number;
}

/**
 * Agrupa por texto. O texto com o destaque mais recente vem primeiro, que e
 * onde a leitura esta acontecendo; dentro do texto, a ordem e a do texto,
 * como na tela de destaques dele.
 *
 * Empate na data segue o titulo, para a ordem nao mudar de uma carga para
 * outra.
 */
export function groupHighlights<T extends LibraryHighlightText>(
  items: LibraryHighlight[],
  texts: T[]
): HighlightGroup<T>[] {
  const byId = new Map(texts.map((text) => [text.id, text]));
  const groups = new Map<string, { text: T; items: LibraryHighlight[]; latest: number }>();

  for (const item of items) {
    const text = byId.get(item.textId);
    if (!text) continue;
    // Data ilegivel vai para o fim, em vez de embaralhar a comparacao com NaN.
    const at = Date.parse(item.createdAt) || 0;
    const group = groups.get(item.textId);
    if (group) {
      group.items.push(item);
      group.latest = Math.max(group.latest, at);
    } else {
      groups.set(item.textId, { text, items: [item], latest: at });
    }
  }

  return [...groups.values()]
    .sort(
      (a, b) =>
        b.latest - a.latest ||
        a.text.title.localeCompare(b.text.title, "pt-BR") ||
        a.text.id.localeCompare(b.text.id)
    )
    .map((group) => ({
      text: group.text,
      items: group.items.sort((a, b) => a.start - b.start),
      count: group.items.length,
    }));
}

/**
 * Recorta os grupos para a tela desenhar no maximo `max` destaques.
 *
 * `count` continua com o total do grupo: o cabecalho diz quantos o texto
 * tem, mesmo que parte deles so apareca depois de "Mostrar mais".
 */
export function limitGroups<T extends LibraryHighlightText>(
  groups: HighlightGroup<T>[],
  max: number
): HighlightGroup<T>[] {
  const limited: HighlightGroup<T>[] = [];
  let room = Math.max(0, Math.trunc(max) || 0);
  for (const group of groups) {
    if (room <= 0) break;
    const items = group.items.slice(0, room);
    limited.push({ ...group, items });
    room -= items.length;
  }
  return limited;
}

/* --- rotulos ------------------------------------------------------------------- */

function counted(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

/** "1 destaque", "12 destaques". */
export function highlightsLabel(count: number): string {
  return counted(count, "destaque", "destaques");
}

/** "12 destaques em 3 textos": a linha sob o titulo da tela e no arquivo. */
export function totalLabel(highlights: number, texts: number): string {
  return `${highlightsLabel(highlights)} em ${counted(texts, "texto", "textos")}`;
}

/**
 * Quantos destaques passaram pela busca e pelo filtro, em uma frase. Null
 * sem busca nem filtro: ai a contagem da tela ja diz tudo.
 */
export function matchLabel(
  matched: number,
  searching: boolean,
  scope: HighlightScope
): string | null {
  if (!searching && scope === "todos") return null;

  const withNote = scope === "com-nota" ? " com nota" : "";
  if (!searching) {
    return matched === 0 ? "Nenhum destaque com nota." : `${highlightsLabel(matched)} com nota.`;
  }
  if (matched === 0) return `Nenhum destaque${withNote} corresponde à busca.`;
  return `${highlightsLabel(matched)}${withNote} ${
    matched === 1 ? "corresponde" : "correspondem"
  } à busca.`;
}

/**
 * Aviso de que o limite cortou a lista; null quando veio tudo. `shown` e
 * quantos foram carregados e `total`, quantos a conta tem.
 */
export function truncationNotice(shown: number, total: number): string | null {
  if (total <= shown) return null;
  return `Mostrando os ${formatNumber(shown)} mais recentes de ${formatNumber(total)}.`;
}

/**
 * Dia de um instante no fuso do leitor, em DD/MM/AAAA. Vazio para data
 * ilegivel.
 *
 * O fuso vem das preferencias, e nao do aparelho, para o servidor e a tela
 * escreverem o mesmo dia: um destaque das 23h nao vira "amanha" no HTML que
 * veio do servidor.
 */
export function dayLabel(value: string | Date, timezone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";

  // Pelas partes, e nao pelo texto pronto: a ordem e o separador que a Intl
  // escolhe podem diferir entre o servidor e o navegador, e a tela precisa
  // escrever a mesma data dos dois lados.
  const parts = new Map(
    dayFormat(timezone)
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return `${parts.get("day")}/${parts.get("month")}/${parts.get("year")}`;
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** Um formatador por fuso: cria-lo a cada cartao da lista seria o custo da tela. */
function dayFormat(timezone: string): Intl.DateTimeFormat {
  const cached = dayFormats.get(timezone);
  if (cached) return cached;

  const format = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    // Fuso que este ambiente nao conhece vira UTC, em vez de a tela cair.
    timeZone: asTimezone(timezone),
  });
  dayFormats.set(timezone, format);
  return format;
}

/* --- exportacao de tudo -------------------------------------------------------- */

export interface LibraryMarkdownOptions {
  /** Fuso do leitor: decide o dia de cada data escrita no arquivo. */
  timezone: string;
  /** Momento da exportacao. */
  now?: Date;
  /** Quantos destaques a conta tem; so importa quando o teto cortou. */
  total?: number;
}

/**
 * Markdown de todos os destaques e notas, um texto por secao.
 *
 * Cada secao abre com o que se sabe do texto (autor, origem, etiquetas e
 * datas, so as linhas que existem) e segue com os trechos como citacao e a
 * nota abaixo, do mesmo jeito que a exportacao de um texto (`excerptLines`):
 * quem ja usa aquele arquivo em outra ferramenta de notas encontra aqui o
 * mesmo formato, com um nivel de titulo a mais.
 *
 * Os textos vem na ordem da tela, com o de destaque mais recente primeiro.
 */
export function libraryMarkdown(
  texts: HighlightExportText[],
  items: LibraryHighlight[],
  { timezone, now = new Date(), total }: LibraryMarkdownOptions
): string {
  const groups = groupHighlights(items, texts);
  const exported = groups.reduce((sum, group) => sum + group.count, 0);
  const lines: string[] = [`# ${HIGHLIGHT_LIBRARY_TITLE}`, ""];

  if (groups.length === 0) {
    lines.push(NO_HIGHLIGHTS_LINE, "");
    return lines.join("\n");
  }

  lines.push(`Exportado em ${dayLabel(now, timezone)}: ${totalLabel(exported, groups.length)}.`, "");

  // O teto da exportacao cortou: o arquivo diz, em vez de parecer completo.
  if (total !== undefined && total > exported) {
    lines.push(
      `Este arquivo traz os ${formatNumber(exported)} destaques mais recentes de ${formatNumber(total)}.`,
      ""
    );
  }

  for (const group of groups) {
    lines.push(`## ${group.text.title}`, "");

    const facts = textFacts(group, timezone);
    if (facts.length > 0) lines.push(...facts.map((fact) => `- ${fact}`), "");

    lines.push(...excerptLines(group.items));
  }

  return lines.join("\n");
}

/**
 * O que se sabe do texto, uma informacao por linha. Vai em lista porque
 * linhas soltas seguidas viram um paragrafo so em muitos leitores de Markdown.
 */
function textFacts(group: HighlightGroup<HighlightExportText>, timezone: string): string[] {
  const { text, items } = group;
  const facts: string[] = [];

  if (text.author) facts.push(`Autor: ${text.author}`);
  if (text.sourceUrl) facts.push(originLine(text.sourceUrl));
  if (text.tags.length > 0) facts.push(`Etiquetas: ${text.tags.join(", ")}`);

  const added = dayLabel(text.createdAt, timezone);
  if (added) facts.push(`Adicionado em: ${added}`);

  const marked = markedOn(items, timezone);
  if (marked) facts.push(`Destacado em: ${marked}`);

  return facts;
}

/** Dia dos destaques do texto, ou do primeiro ao ultimo quando foram em dias diferentes. */
function markedOn(items: LibraryHighlight[], timezone: string): string {
  const times = items
    .map((item) => Date.parse(item.createdAt))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  if (times.length === 0) return "";

  const first = dayLabel(new Date(times[0]!), timezone);
  const last = dayLabel(new Date(times[times.length - 1]!), timezone);
  return first === last ? first : `${first} a ${last}`;
}

/** Nome do arquivo de tudo: `destaques-AAAA-MM-DD.md`, no dia do fuso do leitor. */
export function libraryExportFileName(timezone: string, now = new Date()): string {
  return `destaques-${todayIn(asTimezone(timezone), now)}.md`;
}
