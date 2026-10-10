/**
 * Retencao dos cartoes de estudo de cada texto (US-162). Funcoes puras, com
 * teste.
 *
 * Acerto e qualquer nota diferente de "errei", a mesma regra da retencao das
 * palavras (`retention`). Com poucas revisoes a porcentagem diria pouco: abaixo
 * de 10 a tela mostra "Poucas revisoes para medir." no lugar do numero.
 */

import { PRETEST_ANSWERS } from "@/lib/study-cards";
import { retention } from "@/lib/vocabulary";

/** Janela da retencao, em dias. */
export const CARD_RETENTION_DAYS = 30;
/** Revisoes minimas na janela para mostrar a porcentagem. */
export const MIN_CARD_REVIEWS = 10;
/** Intervalo a partir do qual o cartao e "maduro", em dias. */
export const MATURE_INTERVAL_DAYS = 21;
/** Abaixo desta retencao o texto entra em "Para reler". */
export const REREAD_BELOW_PERCENT = 60;

export type CardRetention =
  | { measured: false; reviews: number }
  | { measured: true; reviews: number; percent: number; mature: number };

/**
 * Retencao de um texto: notas dos ultimos 30 dias e intervalos atuais dos
 * cartoes.
 */
export function cardRetention(grades: string[], intervals: number[]): CardRetention {
  const percent = retention(grades);
  if (grades.length < MIN_CARD_REVIEWS || percent === null) {
    return { measured: false, reviews: grades.length };
  }
  return {
    measured: true,
    reviews: grades.length,
    percent,
    mature: intervals.filter((interval) => interval >= MATURE_INTERVAL_DAYS).length,
  };
}

/**
 * Conhecimento previo (US-170): parcela de "ja sabia" entre os cartoes
 * respondidos no teste. Nulo sem nenhuma resposta.
 */
export function pretestPercent(answers: (string | null)[]): number | null {
  const given = answers.filter((answer): answer is string =>
    PRETEST_ANSWERS.includes(answer as (typeof PRETEST_ANSWERS)[number])
  );
  if (given.length === 0) return null;
  const knew = given.filter((answer) => answer === "sabia").length;
  return Math.round((knew / given.length) * 100);
}

export interface RereadCandidate {
  textId: string;
  title: string;
  grades: string[];
}

/**
 * Textos para reler: retencao medida (10 revisoes ou mais) abaixo de 60%, os
 * piores primeiro.
 */
export function rereadList(
  candidates: RereadCandidate[]
): { textId: string; title: string; percent: number }[] {
  return candidates
    .flatMap((candidate) => {
      const percent = retention(candidate.grades);
      if (candidate.grades.length < MIN_CARD_REVIEWS || percent === null) return [];
      if (percent >= REREAD_BELOW_PERCENT) return [];
      return [{ textId: candidate.textId, title: candidate.title, percent }];
    })
    .sort((a, b) => a.percent - b.percent || a.title.localeCompare(b.title));
}
