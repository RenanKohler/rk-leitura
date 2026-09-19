/**
 * Programa de treino de velocidade.
 *
 * O alvo de cada dia nao e guardado antecipadamente: ele e derivado do que ja
 * aconteceu. Assim o criterio da compreensao funciona mesmo quando o
 * questionario e respondido depois de a sessao terminar - o alvo de amanha
 * ainda nao existia para ser corrigido.
 *
 * Funcoes puras, compartilhadas entre servidor e cliente.
 */

import { COMPREHENSION_FLOOR } from "@/lib/placement";
import { clamp, MAX_WPM, MIN_WPM } from "@/lib/reading";

export const PROGRAM_LENGTHS = [14, 30] as const;
export type ProgramLength = (typeof PROGRAM_LENGTHS)[number];

/**
 * Quanto a velocidade cresce do primeiro ao ultimo dia, por programa.
 *
 * Os dois nao chegam ao mesmo lugar de proposito: se chegassem, a escolha
 * entre catorze e trinta dias seria so uma preferencia de ritmo disfarcada de
 * meta, e a tela mostraria "ate 450 ppm" nas duas opcoes.
 */
export const PROGRAM_GAIN: Record<ProgramLength, number> = { 14: 0.35, 30: 0.6 };

/** Palavras minimas para uma sessao contar como o treino do dia. */
export const MIN_TRAINING_WORDS = 200;

/** Folga aceita abaixo do alvo: a velocidade oscila dentro da propria leitura. */
export const TARGET_TOLERANCE = 0.95;

export function asProgramLength(value: unknown): ProgramLength | null {
  const days = Math.trunc(Number(value));
  return PROGRAM_LENGTHS.includes(days as ProgramLength) ? (days as ProgramLength) : null;
}

/** Um dia ja cumprido do programa. */
export interface TrainingDay {
  day: number;
  targetWpm: number;
  wpm: number;
  /** Acertos do questionario daquela leitura; nulo quando nao houve. */
  comprehension: number | null;
  onDay: string;
}

/** Passo diario, em ppm, para ir do inicio ao ganho previsto. */
export function dailyStep(startWpm: number, length: ProgramLength): number {
  return (startWpm * PROGRAM_GAIN[length]) / (length - 1);
}

/**
 * Passos conquistados ate agora.
 *
 * Um dia cumprido vale um passo, a menos que a compreensao daquele dia tenha
 * ficado abaixo do piso: ler mais rapido entendendo menos nao e treino, e so
 * pressa. Dia sem questionario respondido conta - a falta de medida nao e
 * motivo para punir.
 */
export function earnedSteps(done: TrainingDay[]): number {
  return done.filter(
    (day) => day.comprehension === null || day.comprehension >= COMPREHENSION_FLOOR
  ).length;
}

/**
 * Alvo do dia que esta por vir.
 *
 * Derivado da partida e dos passos conquistados, nao do alvo de ontem mais um
 * passo: somar sobre um valor ja arredondado perde alguns ppm por dia e faz o
 * programa de catorze dias terminar vinte ppm abaixo do que prometeu.
 */
export function targetFor(
  startWpm: number,
  length: ProgramLength,
  done: TrainingDay[]
): number {
  const steps = Math.min(earnedSteps(done), length - 1);
  const target = startWpm + dailyStep(startWpm, length) * steps;
  return clamp(Math.round(target / 10) * 10, MIN_WPM, MAX_WPM);
}

/** Verdadeiro quando a sessao vale como o treino do dia. */
export function qualifies(
  session: { wpm: number; wordsRead: number },
  targetWpm: number
): boolean {
  return (
    session.wordsRead >= MIN_TRAINING_WORDS && session.wpm >= targetWpm * TARGET_TOLERANCE
  );
}

export interface ProgramStatus {
  active: boolean;
  length: ProgramLength;
  startWpm: number;
  /** Velocidade que voltara a valer se o programa for abandonado. */
  previousWpm: number;
  startedOn: string;
  days: TrainingDay[];
  /** Dia em andamento, de 1 ate `length`; `length + 1` quando terminou. */
  currentDay: number;
  targetWpm: number;
  finished: boolean;
  /** Ja cumpriu o dia de hoje? Um dia de calendario, um dia de treino. */
  doneToday: boolean;
}

/** Monta o estado do programa a partir dos dias cumpridos. */
export function programStatus(
  program: {
    length: ProgramLength;
    startWpm: number;
    previousWpm: number;
    startedOn: string;
  },
  days: TrainingDay[],
  today: string
): ProgramStatus {
  const ordered = [...days].sort((a, b) => a.day - b.day);
  const currentDay = ordered.length + 1;
  const finished = ordered.length >= program.length;

  return {
    active: true,
    length: program.length,
    startWpm: program.startWpm,
    previousWpm: program.previousWpm,
    startedOn: program.startedOn,
    days: ordered,
    currentDay: Math.min(currentDay, program.length + 1),
    targetWpm: finished
      ? (ordered.at(-1)?.targetWpm ?? program.startWpm)
      : targetFor(program.startWpm, program.length, ordered),
    finished,
    doneToday: ordered.some((day) => day.onDay === today),
  };
}

/** Meta do ultimo dia, usada para descrever o programa antes de comecar. */
export function finalTarget(startWpm: number, length: ProgramLength): number {
  return clamp(
    Math.round((startWpm + dailyStep(startWpm, length) * (length - 1)) / 10) * 10,
    MIN_WPM,
    MAX_WPM
  );
}
