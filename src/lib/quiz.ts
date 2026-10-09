/**
 * Questionario de compreensao ao fim da leitura.
 *
 * O formato vive separado da geracao porque ele e contrato de duas pontas: o
 * que o modelo devolve e o que a tela consome. A validacao acontece na
 * fronteira, nao na confianca de que a resposta veio bem formada.
 */

// A mesma dobra da busca no texto (US-90): acento, caixa e pontuacao nao contam.
import { searchKey } from "@/lib/navigation";

/**
 * Minimo de palavras para oferecer o questionario. Igual ao minimo de uma
 * sessao de treino (`MIN_TRAINING_WORDS`, 200): com 300, as sessoes de treino
 * entre 200 e 299 palavras cumpriam o dia sem nunca poder medir a
 * compreensao, e o piso de compreensao do programa nao valia para elas.
 */
export const MIN_WORDS_FOR_QUIZ = 200;
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
  /**
   * Por que a correta e a correta (US-135), em ate `MAX_RATIONALE_WORDS`
   * palavras. Ausente nos questionarios gerados antes dessa entrega.
   */
  rationale?: string;
  /**
   * Onde a evidencia esta no texto, em indices de palavra [start, end)
   * (US-134). Ausente quando nao foi encontrada ou nos questionarios antigos.
   */
  position?: EvidenceSpan;
}

export interface EvidenceSpan {
  start: number;
  end: number;
}

/** Teto da explicacao de cada pergunta (US-135). */
export const MAX_RATIONALE_WORDS = 40;

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
 * Chave do questionario em cache: o conteudo e, fora do portugues, o idioma
 * (US-69). Trocar o idioma do texto gera perguntas novas; os questionarios ja
 * gerados para textos em portugues continuam valendo com a chave de antes.
 */
export function quizKey(content: string, language: string): string {
  const key = contentKey(content);
  return language === "pt-BR" ? key : `${key}:${language}`;
}

/**
 * Aceita apenas o que a tela consegue exibir sem quebrar.
 *
 * Uma pergunta com indice fora das alternativas, ou com menos alternativas do
 * que o esperado, seria pior que nenhuma pergunta: ela pareceria valida e
 * marcaria a resposta certa como errada.
 *
 * O minimo e o maximo mudam na checagem da sessao (US-149), que pede so duas
 * perguntas; o questionario do texto inteiro continua com 3 a 5.
 */
export function parseQuiz(
  raw: unknown,
  minQuestions: number = MIN_QUESTIONS,
  maxQuestions: number = MAX_QUESTIONS
): Quiz | null {
  const source = typeof raw === "string" ? safeJson(raw) : raw;
  if (!source || typeof source !== "object") return null;

  const list = (source as { questions?: unknown }).questions;
  if (!Array.isArray(list)) return null;

  const questions: QuizQuestion[] = [];
  for (const item of list) {
    const question = parseQuestion(item);
    if (question) questions.push(question);
  }

  if (questions.length < minQuestions) return null;
  return { questions: questions.slice(0, maxQuestions) };
}

function parseQuestion(raw: unknown): QuizQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  const prompt = asText(item.prompt);
  const evidence = asText(item.evidence);
  const rationale = asText(item.rationale);
  const position = asSpan(item.position);
  const choices = Array.isArray(item.choices)
    ? item.choices.map(asText).filter((choice): choice is string => choice !== null)
    : [];
  const answer = Number(item.answer);

  if (!prompt || choices.length !== CHOICES_PER_QUESTION) return null;
  if (!Number.isInteger(answer) || answer < 0 || answer >= choices.length) return null;
  // Alternativas repetidas tornam a pergunta insoluvel.
  if (new Set(choices).size !== choices.length) return null;

  return {
    prompt,
    choices,
    answer,
    evidence: evidence ?? "",
    // Campos novos so entram quando existem: o JSON dos questionarios antigos
    // continua igual ao que era, sem chave vazia.
    ...(rationale ? { rationale: clampWords(rationale, MAX_RATIONALE_WORDS) } : {}),
    ...(position ? { position } : {}),
  };
}

function asSpan(value: unknown): EvidenceSpan | null {
  if (!value || typeof value !== "object") return null;
  const { start, end } = value as Record<string, unknown>;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if ((start as number) < 0 || (end as number) <= (start as number)) return null;
  return { start: start as number, end: end as number };
}

/** Corta em `max` palavras, terminando em reticencias quando cortou. */
export function clampWords(value: string, max: number): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return `${words.slice(0, max).join(" ").replace(/[\s.,;:!?…-]+$/u, "")}…`;
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

/* --- recorte enviado ao modelo (US-133) ------------------------------------ */

/** Teto do conteudo enviado ao modelo. Igual ao recorte de antes: custo igual. */
export const QUIZ_MAX_CHARS = 60_000;
/** Quantos trechos compoem o recorte de um texto longo. */
export const QUIZ_SAMPLE_BLOCKS = 6;

const SAMPLE_SEPARATOR = "\n\n";

function sampleHeader(position: number, total: number): string {
  return `[Trecho ${position} de ${total}]\n`;
}

export interface QuizSample {
  /** O que vai no pedido, ja com os marcadores de trecho. */
  text: string;
  /** Inicio e fim, em caracteres do conteudo, de cada trecho. Vazio = texto inteiro. */
  blocks: { start: number; end: number }[];
}

/**
 * Recorte do texto para o questionario (US-133).
 *
 * Ate o teto, vai o texto inteiro, como sempre foi. Acima dele, vao trechos
 * equidistantes do comeco ao fim - o primeiro abre o texto e o ultimo o
 * fecha -, cada um comecando num inicio de paragrafo e marcado com a posicao
 * relativa ("trecho 3 de 6"). Antes ia so o comeco, e as perguntas de um
 * livro inteiro cobriam as primeiras paginas. O total, marcadores incluidos,
 * nunca passa do teto.
 */
export function quizSample(
  content: string,
  maxChars: number = QUIZ_MAX_CHARS,
  blockCount: number = QUIZ_SAMPLE_BLOCKS
): QuizSample {
  if (content.length <= maxChars) return { text: content, blocks: [] };

  const count = Math.max(2, blockCount);
  const overhead =
    Array.from({ length: count }, (_, index) => sampleHeader(index + 1, count).length).reduce(
      (sum, size) => sum + size,
      0
    ) +
    SAMPLE_SEPARATOR.length * (count - 1);
  const budget = Math.max(1, Math.floor((maxChars - overhead) / count));
  const length = content.length;
  const step = (length - budget) / (count - 1);

  const blocks: { start: number; end: number }[] = [];
  let floor = 0;
  for (let index = 0; index < count; index += 1) {
    const target = Math.round(index * step);
    const start = blockStart(content, target, floor, budget);
    let end = Math.min(length, start + budget);
    // Nao corta palavra no meio: o fim recua ate o ultimo espaco do trecho.
    if (end < length) {
      const space = content.slice(start, end).search(/\s\S*$/);
      if (space > 0) end = start + space;
    }
    blocks.push({ start, end });
    floor = end;
  }

  const text = blocks
    .map(
      (block, index) =>
        `${sampleHeader(index + 1, count)}${content.slice(block.start, block.end).trim()}`
    )
    .join(SAMPLE_SEPARATOR);

  return { text, blocks };
}

/**
 * Inicio de um trecho perto de `target`: o inicio de paragrafo mais proximo
 * para tras (sem voltar para dentro do trecho anterior) ou, se nao houver, o
 * proximo para a frente dentro de meio trecho. Paragrafo nenhum por perto
 * (texto corrido), o inicio da palavra seguinte.
 */
function blockStart(content: string, target: number, floor: number, budget: number): number {
  if (target <= floor) return floor === 0 ? 0 : nextWord(content, floor);

  const back = content.lastIndexOf("\n", target - 1);
  if (back >= floor) return nextWord(content, back + 1);

  const ahead = content.indexOf("\n", target);
  if (ahead !== -1 && ahead - target <= budget / 2) return nextWord(content, ahead + 1);

  return nextWord(content, target);
}

/** Primeira posicao, a partir de `from`, que comeca uma palavra. */
function nextWord(content: string, from: number): number {
  if (from <= 0) return 0;
  let at = from;
  // No meio de uma palavra: pula ate o fim dela.
  if (/\S/.test(content[at - 1] ?? "")) {
    while (at < content.length && /\S/.test(content[at]!)) at += 1;
  }
  while (at < content.length && /\s/.test(content[at]!)) at += 1;
  return at;
}

/* --- evidencia no texto (US-134) ------------------------------------------- */

/**
 * Onde a evidencia aparece no texto, em indices de palavra [start, end).
 *
 * A comparacao ignora acento, caixa e pontuacao: o modelo copia o trecho, mas
 * troca aspas, apara virgulas e as vezes a caixa da primeira letra. Uma
 * evidencia com reticencias ("A ... B") vale pelos pedacos: o comeco e o do
 * primeiro, o fim e o do ultimo encontrado depois dele. Nada encontrado devolve
 * null, e a tela simplesmente nao oferece o atalho.
 */
export function locateEvidence(words: string[], evidence: string): EvidenceSpan | null {
  const pieces = evidence
    .split(/\.{3,}|…|\[\s*\.\.\.\s*\]/u)
    .map((piece) => piece.split(/\s+/).map(searchKey).filter(Boolean))
    .filter((terms) => terms.length > 0);
  if (pieces.length === 0) return null;

  // Palavras so de pontuacao ("-", "—") nao contam nos dois lados.
  const keys: string[] = [];
  const indexOf: number[] = [];
  words.forEach((word, index) => {
    const key = searchKey(word);
    if (key) {
      keys.push(key);
      indexOf.push(index);
    }
  });

  const first = findTerms(keys, pieces[0]!, 0);
  if (first === -1) return null;

  let endKey = first + pieces[0]!.length;
  let cursor = endKey;
  for (const terms of pieces.slice(1)) {
    const found = findTerms(keys, terms, cursor);
    // Pedaco seguinte longe demais nao e o mesmo trecho.
    if (found === -1 || found - cursor > 200) break;
    endKey = found + terms.length;
    cursor = endKey;
  }

  return { start: indexOf[first]!, end: indexOf[endKey - 1]! + 1 };
}

function findTerms(keys: string[], terms: string[], from: number): number {
  for (let start = from; start + terms.length <= keys.length; start += 1) {
    let match = true;
    for (let offset = 0; offset < terms.length; offset += 1) {
      if (keys[start + offset] !== terms[offset]) {
        match = false;
        break;
      }
    }
    if (match) return start;
  }
  return -1;
}

/**
 * A posicao gravada ainda aponta para a evidencia? O conteudo nao muda sem
 * mudar a chave do questionario, mas o formato (texto simples ou Markdown)
 * muda a contagem de palavras.
 */
function spanMatches(words: string[], evidence: string, span: EvidenceSpan): boolean {
  if (span.end > words.length) return false;
  const head = evidence.split(/\s+/).map(searchKey).find(Boolean);
  if (!head) return false;
  const at = words.slice(span.start, span.end).map(searchKey).find(Boolean);
  return at === head;
}

/**
 * Posicao de cada evidencia: a gravada quando ainda confere, senao calculada
 * agora. Serve tanto para gravar na geracao quanto para os questionarios
 * antigos, localizados na correcao sem chamar o modelo.
 */
export function withEvidencePositions(quiz: Quiz, words: string[]): Quiz {
  return {
    questions: quiz.questions.map((question) => {
      const { position: stored, ...rest } = question;
      if (stored && spanMatches(words, question.evidence, stored)) return question;
      const position = question.evidence ? locateEvidence(words, question.evidence) : null;
      return position ? { ...rest, position } : rest;
    }),
  };
}
