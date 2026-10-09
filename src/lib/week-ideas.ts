/**
 * Ideias da semana no resumo semanal (US-154). Funcoes puras, com teste.
 *
 * O pedido leva so o titulo, a sinopse guardada (US-138) e os destaques da
 * semana de cada texto lido: nunca o conteudo. Texto sem sinopse vai so com
 * titulo e destaques.
 */

/** Abaixo disso nao ha o que relacionar: o cartao fica so com os numeros. */
export const MIN_WEEK_TEXTS = 2;

/** Teto do paragrafo mostrado. */
export const MAX_IDEAS_WORDS = 120;

/** Textos levados ao pedido, os mais lidos primeiro. */
export const MAX_WEEK_TEXTS = 12;

/** Destaques por texto e tamanho de cada um no pedido. */
export const MAX_HIGHLIGHTS_PER_TEXT = 8;
export const MAX_HIGHLIGHT_CHARS = 300;

export interface WeekText {
  title: string;
  /** Sinopse guardada para o conteudo atual, ou null. */
  synopsis: string | null;
  /** Trechos destacados na semana, na ordem do texto. */
  highlights: string[];
}

/** Dia (AAAA-MM-DD) deslocado em `days` dias. */
export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Chave do resultado guardado: a segunda-feira da semana resumida. */
export function weekIdeasKey(monday: string): string {
  return monday;
}

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}...` : clean;
}

/** Mensagem do pedido: um bloco por texto, com sinopse e destaques. */
export function weekIdeasPrompt(items: WeekText[]): string {
  return items
    .slice(0, MAX_WEEK_TEXTS)
    .map((item) => {
      const lines = [`<texto titulo="${item.title.replace(/"/g, "'")}">`];
      if (item.synopsis) lines.push(`Sinopse: ${clip(item.synopsis, 600)}`);
      const marks = item.highlights
        .map((mark) => clip(mark, MAX_HIGHLIGHT_CHARS))
        .filter(Boolean)
        .slice(0, MAX_HIGHLIGHTS_PER_TEXT);
      if (marks.length > 0) {
        lines.push("Destaques:");
        for (const mark of marks) lines.push(`- ${mark}`);
      }
      if (!item.synopsis && marks.length === 0) lines.push("(só o título)");
      lines.push("</texto>");
      return lines.join("\n");
    })
    .join("\n\n");
}

/** Garante o teto de palavras, fechando com reticencias se cortou. */
export function clampIdeas(raw: unknown, maxWords: number = MAX_IDEAS_WORDS): string {
  if (typeof raw !== "string") return "";
  const words = raw.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ").replace(/[.,;:!?…]+$/, "")}…`;
}

/**
 * O botao aparece com pelo menos 2 textos lidos e a IA utilizavel: chave
 * configurada, conta com a IA ligada e, sem paragrafo guardado, cota de
 * resumos sobrando.
 */
export function canOfferWeekIdeas(state: {
  readTexts: number;
  configured: boolean;
  consent: "on" | "off" | "pending";
  quotaLeft: boolean;
  cached: boolean;
}): boolean {
  if (state.readTexts < MIN_WEEK_TEXTS) return false;
  if (!state.configured || state.consent !== "on") return false;
  return state.cached || state.quotaLeft;
}
