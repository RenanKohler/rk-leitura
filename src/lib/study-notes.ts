/**
 * Fichamento do texto (US-165). Funcoes puras, com teste.
 *
 * Cada item traz uma citacao do texto. A citacao e pedida em saida
 * estruturada e conferida aqui: precisa aparecer literalmente no trecho
 * enviado, e vira a posicao que o leitor abre. Item sem citacao valida sai -
 * sem trecho que o sustente, seria opiniao do modelo, nao do texto.
 */

import { exportFileName } from "@/lib/highlights";
import { findQuote, spanText } from "@/lib/passage-match";

export const NOTES_SECTIONS = [
  { key: "ideia", label: "Ideia central" },
  { key: "argumentos", label: "Argumentos" },
  { key: "evidencias", label: "Evidências" },
  { key: "conclusoes", label: "Conclusões" },
] as const;

export type NotesSectionKey = (typeof NOTES_SECTIONS)[number]["key"];

export const MAX_NOTES_ITEMS = 6;
/** Teto de cada item, em caracteres. */
export const MAX_NOTES_ITEM_CHARS = 400;

export const NOTES_NOT_CONCLUDED = "Disponível ao concluir o texto.";

export interface NotesItem {
  text: string;
  /** O trecho citado, como esta no texto. */
  quote: string;
  start: number;
  end: number;
}

export type StudyNotes = Record<NotesSectionKey, NotesItem[]>;

/** Chave do fichamento guardado: texto e impressao do conteudo. */
export function notesKey(textId: string, fingerprint: string): string {
  return `${textId}:${fingerprint}`;
}

function cleanItem(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > MAX_NOTES_ITEM_CHARS ? "" : text;
}

/**
 * Resposta do modelo validada: em cada secao, ate 6 itens com texto e uma
 * citacao que aparece literalmente em [from, to). A citacao guardada e a do
 * proprio texto, nao a escrita pelo modelo.
 */
export function validNotes(
  raw: unknown,
  words: string[],
  keys: string[],
  from: number,
  to: number
): StudyNotes {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const notes = {} as StudyNotes;
  for (const { key } of NOTES_SECTIONS) {
    const list = Array.isArray(source[key]) ? (source[key] as unknown[]) : [];
    const items: NotesItem[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const text = cleanItem((item as { text?: unknown }).text);
      if (!text || seen.has(text.toLowerCase())) continue;
      const span = findQuote(keys, (item as { quote?: unknown }).quote, from, to);
      if (!span) continue;
      seen.add(text.toLowerCase());
      items.push({ text, quote: spanText(words, span), start: span.start, end: span.end });
      if (items.length === MAX_NOTES_ITEMS) break;
    }
    notes[key] = items;
  }
  return notes;
}

export function notesCount(notes: StudyNotes): number {
  return NOTES_SECTIONS.reduce((sum, { key }) => sum + notes[key].length, 0);
}

/** Fichamento lido do banco, ou null quando o formato nao confere. */
export function parseStoredNotes(raw: unknown): StudyNotes | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const notes = {} as StudyNotes;
  for (const { key } of NOTES_SECTIONS) {
    const list = source[key];
    if (!Array.isArray(list)) return null;
    notes[key] = list.filter(
      (item): item is NotesItem =>
        Boolean(item) &&
        typeof item.text === "string" &&
        typeof item.quote === "string" &&
        Number.isInteger(item.start) &&
        Number.isInteger(item.end)
    );
  }
  return notes;
}

/**
 * Markdown do fichamento, no formato da exportacao de destaques: titulo,
 * origem, e cada item seguido da citacao em bloco `>`.
 */
export function notesMarkdown(
  text: { title: string; sourceUrl: string | null },
  notes: StudyNotes
): string {
  const lines: string[] = [`# ${text.title}`, ""];
  if (text.sourceUrl) lines.push(`Origem: <${text.sourceUrl}>`, "");
  lines.push("_Fichamento_", "");
  for (const { key, label } of NOTES_SECTIONS) {
    lines.push(`## ${label}`, "");
    const items = notes[key];
    if (items.length === 0) {
      lines.push("_Nada nesta seção._", "");
      continue;
    }
    for (const item of items) {
      lines.push(`- ${item.text}`, "", `> ${item.quote}`, "");
    }
  }
  return lines.join("\n");
}

export function notesFileName(title: string): string {
  return exportFileName(title).replace(/-destaques\.md$/, "-fichamento.md");
}
