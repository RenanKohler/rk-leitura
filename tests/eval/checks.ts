import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_EXPLANATION_WORDS } from "../../src/lib/explain";
import { CHOICES_PER_QUESTION, MAX_RATIONALE_WORDS } from "../../src/lib/quiz";
import { synopsisExcerpt } from "../../src/lib/synopsis";

/**
 * Verificacoes automaticas da avaliacao de IA (US-142). Funcoes puras: o
 * `run.ts` aplica cada uma a resposta real do modelo, e
 * `tests/eval-checks.test.ts` as testa sem rede, junto com a sanidade dos
 * casos versionados em `tests/eval/casos/`.
 */

export interface EvalCase {
  id: string;
  title: string;
  language: string;
  content: string;
  /** Trecho cujo fim marca a posicao de leitura. */
  stopAfter: string;
  /** Pergunta respondida pelo trecho ja lido. */
  question: string;
  /** Comeco da frase a explicar. */
  explain: string;
  /** Nomes que a lista de nomes do texto traria. */
  names: string[];
  /** Termos que so aparecem depois da posicao: nao podem vazar. */
  afterPosition: string[];
}

export const CASES_DIR = join(__dirname, "casos");

export function loadCases(dir: string = CASES_DIR): EvalCase[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as EvalCase);
}

/** Espacos colapsados: a comparacao literal nao depende de quebra de linha. */
export function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Indice da primeira palavra de `phrase` no texto, ou -1. */
export function wordIndexOf(content: string, phrase: string): number {
  const at = content.indexOf(phrase);
  return at === -1 ? -1 : countWords(content.slice(0, at));
}

/** Palavras lidas: ate o fim de `stopAfter`, inclusive. */
export function readPosition(item: EvalCase): number {
  const start = wordIndexOf(item.content, item.stopAfter);
  return start === -1 ? -1 : start + countWords(item.stopAfter);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** O termo aparece como palavra inteira, sem diferenca de maiusculas. */
export function mentions(text: string, term: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

/** Termos de "so depois da posicao" que apareceram na resposta. */
export function forbiddenProblems(output: string, terms: string[]): string[] {
  return terms
    .filter((term) => mentions(output, term))
    .map((term) => `revelou "${term}", que só aparece depois da posição`);
}

export interface QuizLike {
  questions: { prompt: string; choices: string[]; evidence: string; rationale?: string }[];
}

/**
 * Evidencia literal no texto, 4 alternativas distintas (sem diferenca de
 * maiusculas e espacos) e justificativa dentro do teto de palavras.
 */
export function quizProblems(quiz: QuizLike, content: string): string[] {
  const problems: string[] = [];
  const text = normalize(content);
  quiz.questions.forEach((question, index) => {
    const label = `pergunta ${index + 1}`;
    const evidence = normalize(question.evidence);
    if (!evidence) problems.push(`${label}: sem evidência`);
    else if (!text.includes(evidence)) problems.push(`${label}: evidência fora do texto: "${evidence}"`);

    const distinct = new Set(question.choices.map((choice) => normalize(choice).toLowerCase()));
    if (question.choices.length !== CHOICES_PER_QUESTION || distinct.size !== CHOICES_PER_QUESTION) {
      problems.push(`${label}: alternativas não são ${CHOICES_PER_QUESTION} distintas`);
    }

    const rationaleWords = countWords(question.rationale ?? "");
    if (rationaleWords === 0) problems.push(`${label}: sem justificativa`);
    else if (rationaleWords > MAX_RATIONALE_WORDS) {
      problems.push(`${label}: justificativa com ${rationaleWords} palavras (máximo ${MAX_RATIONALE_WORDS})`);
    }
  });
  return problems;
}

export interface AnswerLike {
  text: string;
  citations: { start: number; end: number; quote: string }[];
}

/** Toda citacao dentro do recorte enviado, no texto e no indice de palavras. */
export function citationProblems(
  answer: AnswerLike,
  excerpt: { text: string; startWord: number; endWord: number }
): string[] {
  if (answer.citations.length === 0) return ["resposta sem citação"];
  const sent = normalize(excerpt.text);
  const problems: string[] = [];
  for (const citation of answer.citations) {
    const quote = normalize(citation.quote);
    if (!quote || !sent.includes(quote)) problems.push(`citação fora do recorte: "${quote}"`);
    if (citation.start < excerpt.startWord || citation.end > excerpt.endWord) {
      problems.push(`citação [${citation.start}, ${citation.end}) além da palavra ${excerpt.endWord}`);
    }
  }
  return problems;
}

export interface ExplanationLike {
  simple: string;
  translation: string | null;
  explanation: string;
}

export function explanationProblems(result: ExplanationLike, foreign: boolean): string[] {
  const problems: string[] = [];
  if (!result.simple.trim()) problems.push("sem reescrita simples");
  const words = countWords(result.explanation);
  if (words === 0) problems.push("sem explicação");
  if (words > MAX_EXPLANATION_WORDS) {
    problems.push(`explicação com ${words} palavras (máximo ${MAX_EXPLANATION_WORDS})`);
  }
  if (foreign && !result.translation?.trim()) problems.push("texto em outro idioma sem tradução");
  return problems;
}

/**
 * Sanidade do proprio caso: posicao e frase encontradas, e cada termo de "so
 * depois" realmente ausente de tudo que vai ao modelo nas funcoes com recorte
 * (o trecho lido, o comeco da sinopse e o titulo). Caso mal escrito acusaria
 * o modelo de um vazamento que nao houve.
 */
export function caseProblems(item: EvalCase): string[] {
  const problems: string[] = [];
  const position = readPosition(item);
  if (position === -1) problems.push("stopAfter não encontrado no texto");
  if (wordIndexOf(item.content, item.explain) === -1) problems.push("explain não encontrado no texto");
  if (item.afterPosition.length === 0) problems.push("sem termos de depois da posição");

  const words = item.content.trim().split(/\s+/);
  const read = words.slice(0, Math.max(0, position)).join(" ");
  const synopsis = synopsisExcerpt(item.content);
  for (const term of item.afterPosition) {
    if (!mentions(item.content, term)) problems.push(`"${term}" não aparece no texto`);
    if (mentions(read, term)) problems.push(`"${term}" aparece antes da posição`);
    if (mentions(synopsis, term)) problems.push(`"${term}" aparece no começo enviado à sinopse`);
    if (mentions(item.title, term)) problems.push(`"${term}" aparece no título`);
  }
  if (wordIndexOf(item.content, item.explain) >= position) {
    problems.push("a frase a explicar fica depois da posição");
  }
  return problems;
}
