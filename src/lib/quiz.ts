/**
 * Questionario de compreensao ao fim da leitura.
 *
 * O formato vive separado da geracao porque ele e contrato de duas pontas: o
 * que o modelo devolve e o que a tela consome. A validacao acontece na
 * fronteira, nao na confianca de que a resposta veio bem formada.
 */

export const MIN_WORDS_FOR_QUIZ = 300;
export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 5;
export const CHOICES_PER_QUESTION = 4;

export interface QuizQuestion {
  /** Enunciado. */
  prompt: string;
  /** Alternativas, sempre em numero fixo. */
  choices: string[];
  /** Indice da correta dentro de `choices`. */
  answer: number;
  /** Trecho do texto que justifica a resposta. */
  evidence: string;
}

export interface Quiz {
  questions: QuizQuestion[];
}

/**
 * Impressao do conteudo, usada como chave de cache.
 *
 * Nao precisa ser criptografica: serve para dizer "este e outro texto", e o
 * unico atacante possivel seria o dono do proprio texto. Tamanho mais um hash
 * barato ja separa versoes na pratica, inclusive quando a continuacao anexa
 * uma parte nova.
 */
export function contentKey(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${content.length}-${(hash >>> 0).toString(36)}`;
}

/**
 * Aceita apenas o que a tela consegue exibir sem quebrar.
 *
 * Uma pergunta com indice fora das alternativas, ou com menos alternativas do
 * que o esperado, seria pior que nenhuma pergunta: ela pareceria valida e
 * marcaria a resposta certa como errada.
 */
export function parseQuiz(raw: unknown): Quiz | null {
  const source = typeof raw === "string" ? safeJson(raw) : raw;
  if (!source || typeof source !== "object") return null;

  const list = (source as { questions?: unknown }).questions;
  if (!Array.isArray(list)) return null;

  const questions: QuizQuestion[] = [];
  for (const item of list) {
    const question = parseQuestion(item);
    if (question) questions.push(question);
  }

  if (questions.length < MIN_QUESTIONS) return null;
  return { questions: questions.slice(0, MAX_QUESTIONS) };
}

function parseQuestion(raw: unknown): QuizQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  const prompt = asText(item.prompt);
  const evidence = asText(item.evidence);
  const choices = Array.isArray(item.choices)
    ? item.choices.map(asText).filter((choice): choice is string => choice !== null)
    : [];
  const answer = Number(item.answer);

  if (!prompt || choices.length !== CHOICES_PER_QUESTION) return null;
  if (!Number.isInteger(answer) || answer < 0 || answer >= choices.length) return null;
  // Alternativas repetidas tornam a pergunta insoluvel.
  if (new Set(choices).size !== choices.length) return null;

  return { prompt, choices, answer, evidence: evidence ?? "" };
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Porcentagem de acertos, arredondada. */
export function scoreQuiz(quiz: Quiz, answers: number[]): number {
  if (quiz.questions.length === 0) return 0;
  const right = quiz.questions.filter((question, index) => answers[index] === question.answer);
  return Math.round((right.length / quiz.questions.length) * 100);
}
