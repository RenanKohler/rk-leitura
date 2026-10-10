/**
 * Regras dos cartoes de estudo (US-155 a US-170). Funcoes puras, com teste.
 *
 * Os cartoes sao gerados a partir do texto completo, para terem o contexto
 * inteiro, mas a regra de nao revelar o que vem depois passa para a exibicao:
 * um cartao so aparece, e so entra na revisao, quando o trecho de origem ja
 * foi lido. Os demais ficam para o teste de conhecimento previo (US-170).
 */

export const STUDY_CARD_KINDS = ["conceito", "ponto", "lacuna", "trecho", "manual", "glossario"] as const;
export type StudyCardKind = (typeof STUDY_CARD_KINDS)[number];

export const STUDY_CARD_KIND_LABELS: Record<StudyCardKind, string> = {
  conceito: "Conceito",
  ponto: "Ponto principal",
  lacuna: "Lacuna",
  trecho: "Trecho",
  manual: "Manual",
  glossario: "Glossário",
};

/** Limite de cada lado do cartao, em caracteres (US-159). */
export const MAX_CARD_SIDE_CHARS = 500;

/** Respostas do teste de conhecimento previo (US-170). */
export const PRETEST_ANSWERS = ["sabia", "nao_sabia"] as const;
export type PretestAnswer = (typeof PRETEST_ANSWERS)[number];

export function isStudyCardKind(value: unknown): value is StudyCardKind {
  return STUDY_CARD_KINDS.includes(value as StudyCardKind);
}

export function isPretestAnswer(value: unknown): value is PretestAnswer {
  return PRETEST_ANSWERS.includes(value as PretestAnswer);
}

/** Onde o leitor esta no texto. */
export interface ReadingProgress {
  /** Palavra atual da leitura (`texts.progress_index`). */
  progressIndex: number;
  wordCount: number;
}

/** Texto concluido: a posicao alcancou a contagem de palavras. */
export function isConcluded({ progressIndex, wordCount }: ReadingProgress): boolean {
  return wordCount > 0 && progressIndex >= wordCount - 1;
}

/**
 * O trecho de origem ja foi lido. `sourceEnd` e exclusivo; a palavra da
 * posicao atual conta como lida, porque e a que esta na tela.
 */
export function isCardRead(card: { sourceEnd: number }, progress: ReadingProgress): boolean {
  return isConcluded(progress) || card.sourceEnd <= progress.progressIndex + 1;
}

/** Separa os cartoes que podem ser mostrados dos que ficam para o teste previo. */
export function splitByReading<T extends { sourceEnd: number }>(
  cards: T[],
  progress: ReadingProgress
): { read: T[]; unread: T[] } {
  const read: T[] = [];
  const unread: T[] = [];
  for (const card of cards) (isCardRead(card, progress) ? read : unread).push(card);
  return { read, unread };
}

/**
 * Vencido para revisao hoje. Cartao lido que nunca entrou na revisao
 * (`nextReviewOn` nulo) vence assim que o trecho e lido: e a forma de os
 * cartoes de trechos nao lidos entrarem na revisao conforme a leitura avanca,
 * sem nova geracao.
 */
export function isCardDue(
  card: { sourceEnd: number; nextReviewOn: string | null },
  progress: ReadingProgress,
  today: string
): boolean {
  if (!isCardRead(card, progress)) return false;
  return card.nextReviewOn === null || card.nextReviewOn <= today;
}

/** Lado do cartao normalizado, ou null quando vazio ou longo demais. */
export function cardSide(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > MAX_CARD_SIDE_CHARS) return null;
  return trimmed;
}
