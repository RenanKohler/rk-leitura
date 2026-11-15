/**
 * Questionario refeito depois de concluir o texto (US-169). Funcoes puras, com
 * teste.
 *
 * Conclusao: a primeira sessao de leitura marcada como concluida
 * (`reading_sessions.completed`) que tem nota de compreensao. E nessa sessao
 * que a resposta ao questionario e anotada (a rota de respostas grava na
 * sessao mais recente do texto, que e a que acabou de concluir), entao a data
 * dela e a da conclusao e a nota dela e a original. Texto concluido sem nota
 * nao volta: nao ha o que comparar.
 *
 * O questionario volta 7 e 30 dias depois. Quem so aparece depois dos 30 dias
 * sem ter feito a rodada de 7 faz so a de 30: e a ultima, e a de 7 ja nao
 * mediria o que se propoe.
 *
 * A rodada tem prazo (US-223): a de 7 e trocada pela de 30 no dia 30, e a de
 * 30 deixa de ser oferecida `RECALL_EXPIRY_DAYS` depois de vencer. Sem isso
 * o questionario de um texto antigo ficava para sempre na frente da revisao
 * do dia, por ser o item mais atrasado. A rodada tambem pode ser dispensada:
 * ai ela conta como encerrada, sem nota, e a seguinte continua valendo.
 */

import { addDays } from "@/lib/vocabulary";
import type { Quiz } from "@/lib/quiz";

export const RECALL_ROUNDS = [7, 30] as const;
export type RecallRound = (typeof RECALL_ROUNDS)[number];

export function isRecallRound(value: unknown): value is RecallRound {
  return RECALL_ROUNDS.includes(value as RecallRound);
}

/** Dia em que a rodada vence. */
export function recallDueOn(concludedOn: string, round: RecallRound): string {
  return addDays(concludedOn, round);
}

/**
 * Dias em que a ultima rodada continua sendo oferecida depois de vencer
 * (US-223). Com 30, a rodada de 30 dias vale do dia 30 ao 59 e some no dia 60
 * da conclusao: o mesmo folego que a de 7 tem ate ser trocada pela de 30.
 */
export const RECALL_EXPIRY_DAYS = 30;

const LAST_ROUND: RecallRound = RECALL_ROUNDS[RECALL_ROUNDS.length - 1]!;

/**
 * Primeiro dia em que a rodada ja nao e oferecida: o vencimento da rodada
 * seguinte, que toma o lugar dela, ou o fim do prazo quando e a ultima.
 */
export function recallExpiresOn(concludedOn: string, round: RecallRound): string {
  const following: RecallRound | undefined = RECALL_ROUNDS[RECALL_ROUNDS.indexOf(round) + 1];
  return following
    ? recallDueOn(concludedOn, following)
    : addDays(recallDueOn(concludedOn, round), RECALL_EXPIRY_DAYS);
}

/**
 * Rodada vencida hoje, ou null. A mais tardia ja alcancada vale; se ela ja foi
 * encerrada, nao ha nada (a de 7 nao volta depois da de 30), e passado o
 * prazo dela tambem nao (US-223).
 *
 * `done` sao as rodadas encerradas: respondidas ou dispensadas. Dispensar a
 * de 7 nao encerra a de 30.
 */
export function dueRecallRound(
  concludedOn: string,
  today: string,
  done: readonly number[]
): RecallRound | null {
  for (const round of [...RECALL_ROUNDS].reverse()) {
    if (recallDueOn(concludedOn, round) <= today) {
      if (done.includes(round)) return null;
      return today < recallExpiresOn(concludedOn, round) ? round : null;
    }
  }
  return null;
}

/**
 * Proxima rodada que ainda vai vencer depois de hoje, para contar "amanha".
 * Rodada que ainda nao venceu tambem nao expirou (o prazo so corre depois do
 * vencimento); o que tira uma rodada futura daqui e ela, ou a ultima, ja
 * estar encerrada.
 */
export function nextRecallDueOn(
  concludedOn: string,
  today: string,
  done: readonly number[]
): string | null {
  if (done.includes(LAST_ROUND)) return null;
  for (const round of RECALL_ROUNDS) {
    const day = recallDueOn(concludedOn, round);
    if (day > today && !done.includes(round)) return day;
  }
  return null;
}

/** Gerador pseudoaleatorio a partir de um texto: mesma semente, mesma ordem. */
function seeded(seed: string): () => number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ordem nova das alternativas: `order[i]` e o indice original da alternativa
 * mostrada na posicao `i`. Deterministica pela semente, para a correcao no
 * servidor refazer a mesma ordem sem guardar nada. Nunca devolve a ordem
 * original: reembaralhar e o que impede responder pela posicao lembrada.
 */
export function shuffledOrder(length: number, seed: string): number[] {
  const order = Array.from({ length }, (_, index) => index);
  if (length < 2) return order;
  const random = seeded(seed);
  for (let index = length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [order[index], order[other]] = [order[other]!, order[index]!];
  }
  if (order.every((value, index) => value === index)) order.push(order.shift()!);
  return order;
}

export interface RecallQuestion {
  prompt: string;
  choices: string[];
  /** Indice da correta na ordem nova. */
  answer: number;
}

/** O questionario guardado com as alternativas reembaralhadas. */
export function recallQuestions(quiz: Quiz, seed: string): RecallQuestion[] {
  return quiz.questions.map((question, index) => {
    const order = shuffledOrder(question.choices.length, `${seed}:${index}`);
    return {
      prompt: question.prompt,
      choices: order.map((original) => question.choices[original]!),
      answer: order.indexOf(question.answer),
    };
  });
}

/** Semente da rodada: o mesmo texto embaralha diferente aos 7 e aos 30 dias. */
export function recallSeed(textId: string, round: RecallRound): string {
  return `${textId}:${round}`;
}

/** Porcentagem de acertos, arredondada. */
export function scoreRecall(questions: RecallQuestion[], answers: number[]): number {
  if (questions.length === 0) return 0;
  const right = questions.filter((question, index) => answers[index] === question.answer).length;
  return Math.round((right / questions.length) * 100);
}
