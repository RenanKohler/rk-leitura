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

/* --- quatro respostas (PROD-7) --------------------------------------------- */

/**
 * Respostas da revisao. Substituem o "lembrei / nao lembrei": duas opcoes
 * tratavam igual a palavra lembrada com esforco e a obvia, e as obvias
 * voltavam cedo demais enquanto as dificeis sumiam por semanas.
 */
export const REVIEW_GRADES = ["errei", "dificil", "bom", "facil"] as const;
export type ReviewGrade = (typeof REVIEW_GRADES)[number];

export const GRADE_LABELS: Record<ReviewGrade, string> = {
  errei: "Errei",
  dificil: "Dificil",
  bom: "Bom",
  facil: "Facil",
};

/** Multiplicador do intervalo atual por resposta; "errei" volta a 1 dia. */
export const GRADE_FACTORS: Record<Exclude<ReviewGrade, "errei">, number> = {
  dificil: 1.2,
  bom: 2.5,
  facil: 4,
};

/** A partir deste intervalo, em dias, a palavra se forma: vira "aprendida". */
export const GRADUATION_DAYS = 90;

export function isReviewGrade(value: unknown): value is ReviewGrade {
  return REVIEW_GRADES.includes(value as ReviewGrade);
}

/**
 * Intervalo atual de um item.
 *
 * Quem ja tem intervalo gravado usa ele. Palavra revisada so pelo esquema
 * antigo de etapas usa o intervalo daquela etapa; item nunca revisado vale 1
 * dia, que e o tempo entre salvar e a primeira revisao.
 */
export function currentInterval(interval: number | null | undefined, step = 0): number {
  if (interval && interval > 0) return interval;
  const legacy = REVIEW_INTERVALS[Math.min(Math.max(step, 0), REVIEW_INTERVALS.length - 1)];
  return step > 0 && legacy ? legacy : 1;
}

/** Intervalo seguinte, em dias; a tela usa para mostrar o efeito de cada botao. */
export function gradeInterval(interval: number, grade: ReviewGrade): number {
  const base = Math.max(1, Math.trunc(interval) || 1);
  return grade === "errei" ? 1 : Math.max(base + 1, Math.ceil(base * GRADE_FACTORS[grade]));
}

/**
 * Proxima revisao depois de uma das quatro respostas.
 *
 * Errei = 1 dia; Dificil = intervalo x1,2; Bom = x2,5; Facil = x4. O
 * resultado e arredondado para cima e sempre cresce pelo menos um dia nas
 * respostas certas: 1 x 1,2 arredondado para baixo daria 1 de novo, e
 * "dificil" viraria "errei" disfarcado. Chegar a 90 dias forma o item
 * (`graduated`): a palavra passa a aprendida e sai da revisao.
 */
export function afterGrade(
  interval: number,
  grade: ReviewGrade,
  today: string
): { interval: number; nextReviewOn: string; graduated: boolean } {
  const next = gradeInterval(interval, grade);
  return {
    interval: next,
    nextReviewOn: addDays(today, next),
    graduated: grade !== "errei" && next >= GRADUATION_DAYS,
  };
}

/**
 * Resposta pedida a uma rota de revisao: uma das quatro, ou o `remembered`
 * antigo traduzido (lembrei = "bom", nao lembrei = "errei").
 */
export function gradeFrom(
  body: { grade?: unknown; remembered?: unknown } | null
): ReviewGrade | null {
  if (isReviewGrade(body?.grade)) return body.grade;
  if (typeof body?.remembered === "boolean") return body.remembered ? "bom" : "errei";
  return null;
}

/**
 * Retencao: parcela das respostas que nao foram "errei", em porcentagem.
 * Nulo sem respostas - 0% seria dizer que o leitor esqueceu tudo.
 */
export function retention(grades: string[]): number | null {
  if (grades.length === 0) return null;
  const kept = grades.filter((grade) => grade !== "errei").length;
  return Math.round((kept / grades.length) * 100);
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
