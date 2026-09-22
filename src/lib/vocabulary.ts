/**
 * Revisao das palavras salvas (US-64 a US-66).
 *
 * Regras puras: o intervalo entre revisoes, o que esta vencido e o CSV de
 * exportacao. As datas sao dias ja resolvidos no fuso do usuario (AAAA-MM-DD),
 * a mesma convencao de meta e sequencia.
 */

/** Dias ate a proxima revisao, por etapa. Acertar avanca uma etapa. */
export const REVIEW_INTERVALS = [1, 3, 7, 14, 30] as const;

/** Palavras apresentadas por sessao de revisao. */
export const REVIEW_SESSION_SIZE = 20;

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Proxima revisao depois de uma resposta.
 *
 * "Lembrei" avanca para o proximo intervalo da sequencia e para no ultimo;
 * "nao lembrei" volta ao primeiro.
 */
export function afterAnswer(
  step: number,
  remembered: boolean,
  today: string
): { step: number; nextReviewOn: string } {
  const last = REVIEW_INTERVALS.length - 1;
  const next = remembered ? Math.min(Math.max(step, 0) + 1, last) : 0;
  return { step: next, nextReviewOn: addDays(today, REVIEW_INTERVALS[next]!) };
}

/** Palavra nova: primeira revisao no dia seguinte. */
export function firstReview(today: string): { step: number; nextReviewOn: string } {
  return { step: 0, nextReviewOn: addDays(today, REVIEW_INTERVALS[0]) };
}

/**
 * Vencida hoje. Palavra salva antes da revisao existir nao tem data e conta
 * como vencida: e a forma de ela entrar na primeira sessao.
 */
export function isDue(nextReviewOn: string | null, today: string): boolean {
  return nextReviewOn === null || nextReviewOn <= today;
}

export interface ExportedWord {
  word: string;
  base: string;
  kind: string;
  definition: string;
  translation: string | null;
  context: string | null;
  textTitle: string | null;
}

const CSV_HEADER = [
  "palavra",
  "forma base",
  "classe",
  "definicao",
  "traducao",
  "frase de origem",
  "titulo do texto",
];

function csvCell(value: string | null): string {
  const text = value ?? "";
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV das palavras (US-65).
 *
 * UTF-8 com BOM: sem ele, planilhas abrem acentos como lixo. Aspas, virgulas e
 * quebras de linha ficam dentro de aspas, entao cada palavra ocupa uma linha
 * logica mesmo quando a definicao tem varias frases.
 */
export function wordsCsv(words: ExportedWord[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const word of words) {
    lines.push(
      [
        word.word,
        word.base,
        word.kind,
        word.definition,
        word.translation,
        word.context,
        word.textTitle,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
