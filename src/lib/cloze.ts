/**
 * Perguntas de lacuna (cloze) montadas do proprio texto, sem modelo de
 * linguagem (PROD-3).
 *
 * E o plano B do questionario: quando a geracao por IA nao esta disponivel
 * (instalacao sem chave, cota esgotada, servico fora), o leitor ainda pode
 * conferir se acompanhou o trecho. A pergunta e uma frase do trecho com uma
 * palavra de conteudo escondida; as alternativas sao outras palavras do mesmo
 * texto, de tamanho parecido, para que o comprimento nao entregue a resposta.
 *
 * Tudo aqui e deterministico a partir de uma semente: o servidor corrige
 * remontando as mesmas perguntas, sem guardar gabarito em lugar nenhum.
 */

import { CHOICES_PER_QUESTION, type QuizQuestion } from "@/lib/quiz";

/** Tamanho minimo da palavra escondida, em letras. */
export const MIN_CLOZE_LETTERS = 6;
/** Perguntas por rodada: poucas, porque cada uma e uma frase inteira para reler. */
export const MIN_CLOZE_QUESTIONS = 2;
export const MAX_CLOZE_QUESTIONS = 3;
/** Frases curtas demais nao dao contexto; longas demais cansam na tela. */
const MIN_SENTENCE_WORDS = 6;
const MAX_SENTENCE_WORDS = 45;
/** Diferenca maxima de letras entre a resposta e uma alternativa. */
const LENGTH_SLACK = 2;
export const BLANK = "_____";

/**
 * Palavras funcionais longas o bastante para passar no filtro de tamanho.
 * Escondidas, elas testariam gramatica, nao compreensao do trecho.
 */
const FUNCTION_WORDS = new Set(
  [
    // portugues
    "aquela", "aquele", "aquelas", "aqueles", "aquilo", "apenas", "atraves", "depois",
    "durante", "enquanto", "entanto", "entretanto", "estava", "estavam", "estiver", "estivesse",
    "mesmos", "mesmas", "muitos", "muitas", "nenhum", "nenhuma", "nenhuns", "nenhumas", "nossos",
    "nossas", "outros", "outras", "porque", "portanto", "porem", "quando", "quanto", "quantos",
    "quantas", "qualquer", "quaisquer", "sempre", "seriam", "sobretudo", "somente", "talvez",
    "tambem", "tinham", "tiveram", "alguma", "algumas", "alguns", "algum", "contra", "embora",
    "tampouco", "naquela", "naquele", "daquela", "daquele", "daquilo", "naquilo", "desses",
    "dessas", "destes", "destas", "nesses", "nessas", "nestes", "nestas", "aquelas", "aonde",
    "adiante", "abaixo", "acima", "afinal", "agora", "ainda", "antes", "cada", "mediante",
    "perante", "podia", "podiam", "poderia", "poderiam", "sequer", "seriam", "estavamos",
    "fossem", "tenham", "tivesse", "tinha", "teriam", "haviam", "havia", "houve", "houvesse",
    "segundo", "conforme", "nenhures", "outrora", "deveria", "deveriam", "estamos",
    "estiveram", "quaisquer", "pouquinho", "bastante", "demais", "dentro", "diante", "embaixo",
    "enfim", "logo", "longe", "perto", "quase", "senao", "sobre", "tanto", "todavia",
    "tambem", "voces", "comigo", "consigo", "conosco", "contigo", "convosco", "nosso",
    "nossa", "vosso", "vossa", "minhas", "meus", "tuas", "teus", "suas", "seus", "desta",
    "deste", "nesta", "neste", "dessa", "desse", "nessa", "nesse", "aquela", "aquelas",
    // ingles e espanhol, idiomas aceitos pelo app
    "because", "before", "should", "would", "could", "through", "though", "although", "without",
    "within", "between", "another", "whether", "neither", "either", "rather", "itself", "myself",
    "himself", "herself", "themselves", "ourselves", "yourself", "whatever", "whenever",
    "wherever", "however", "therefore", "around", "during", "against", "toward", "towards",
    "things", "something", "anything", "nothing", "everything", "someone", "anyone", "everyone",
    "cuando", "porque", "tambien", "aunque", "mientras", "despues", "durante", "siempre",
    "nuestro", "nuestra", "nuestros", "nuestras", "entonces", "algunos", "algunas", "ninguno",
    "ninguna", "estaba", "estaban", "tenian", "habian", "hubiera", "cualquier",
  ].map(fold)
);

function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Letras da palavra, sem pontuacao nas pontas ("dizia," -> "dizia"). */
export function bareWord(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function letterCount(word: string): number {
  return (word.match(/\p{L}/gu) ?? []).length;
}

function isCapitalized(word: string): boolean {
  const first = word.charAt(0);
  return first !== first.toLowerCase() && first === first.toUpperCase();
}

/** Palavra que carrega conteudo: longa, so letras (e hifen), nao funcional. */
export function isContentWord(word: string, minLetters = MIN_CLOZE_LETTERS): boolean {
  if (!/^[\p{L}][\p{L}-]*$/u.test(word)) return false;
  if (letterCount(word) < minLetters) return false;
  return !FUNCTION_WORDS.has(fold(word));
}

/** Fim de frase: ponto, exclamacao, interrogacao ou reticencias, antes de aspas. */
export function endsSentence(token: string): boolean {
  return /[.!?…]["'”’»)\]]*$/.test(token);
}

export interface Sentence {
  /** Indice da primeira palavra, no sistema de indices do texto. */
  start: number;
  words: string[];
}

/** Divide a lista corrida em frases, sem perder os indices. */
export function sentencesOf(words: string[], offset = 0): Sentence[] {
  const sentences: Sentence[] = [];
  let current: string[] = [];
  let start = offset;
  words.forEach((token, index) => {
    if (current.length === 0) start = offset + index;
    current.push(token);
    if (endsSentence(token)) {
      sentences.push({ start, words: current });
      current = [];
    }
  });
  if (current.length > 0) sentences.push({ start, words: current });
  return sentences;
}

/* --- sorteio deterministico ------------------------------------------------ */

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32: pequeno, rapido e o mesmo em qualquer maquina. */
function random(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], next: () => number): T[] {
  const list = [...items];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [list[index], list[other]] = [list[other]!, list[index]!];
  }
  return list;
}

/* --- montagem -------------------------------------------------------------- */

export interface ClozeOptions {
  /** Semente do sorteio: a mesma semente monta as mesmas perguntas. */
  seed: string;
  /** Quantas perguntas tentar; entre 2 e 3. */
  count?: number;
}

/**
 * Candidatas a lacuna numa frase: palavras de conteudo, em minuscula, fora da
 * primeira posicao. A inicial maiuscula e descartada inteira: no meio da
 * frase ela indica nome proprio, que qualquer um adivinha pelas
 * alternativas; no comeco da frase nao ha como distinguir nome de palavra
 * comum, e o seguro e nao escolher.
 */
function candidatesIn(sentence: Sentence): number[] {
  const found: number[] = [];
  sentence.words.forEach((token, position) => {
    if (position === 0) return;
    const word = bareWord(token);
    if (!isContentWord(word) || isCapitalized(word)) return;
    found.push(position);
  });
  return found;
}

/**
 * Perguntas de lacuna a partir das palavras de um trecho.
 *
 * Escolhe frases espalhadas pelo trecho (uma por fatia), esconde a palavra de
 * conteudo mais longa de cada uma - com a semente desempatando - e completa
 * com tres alternativas do proprio trecho de tamanho parecido. Devolve menos
 * de duas perguntas quando o trecho nao da material; quem chama decide o que
 * fazer com isso.
 */
export function buildCloze(words: string[], options: ClozeOptions): QuizQuestion[] {
  const count = Math.min(
    MAX_CLOZE_QUESTIONS,
    Math.max(MIN_CLOZE_QUESTIONS, options.count ?? MAX_CLOZE_QUESTIONS)
  );
  const next = random(options.seed);

  // Vocabulario do trecho para as alternativas, sem repetir palavra.
  const pool = new Map<string, string>();
  for (const token of words) {
    const word = bareWord(token);
    if (!isContentWord(word) || isCapitalized(word)) continue;
    const key = fold(word);
    if (!pool.has(key)) pool.set(key, word);
  }

  // Frase repetida (refrao, texto colado duas vezes) entra uma vez so: duas
  // perguntas sobre a mesma frase dariam a resposta uma da outra.
  const seen = new Set<string>();
  const usable = sentencesOf(words).filter(
    (sentence) =>
      !seen.has(sentence.words.join(" ")) &&
      Boolean(seen.add(sentence.words.join(" "))) &&
      sentence.words.length >= MIN_SENTENCE_WORDS &&
      sentence.words.length <= MAX_SENTENCE_WORDS &&
      candidatesIn(sentence).length > 0
  );
  if (usable.length === 0) return [];

  // Uma frase por fatia do trecho: perguntas amontoadas no comeco mediriam so
  // o primeiro paragrafo.
  const slices = Math.min(count, usable.length);
  const chosen: Sentence[] = [];
  for (let slice = 0; slice < slices; slice += 1) {
    const from = Math.floor((slice * usable.length) / slices);
    const to = Math.floor(((slice + 1) * usable.length) / slices);
    chosen.push(usable[from + Math.floor(next() * Math.max(1, to - from))]!);
  }

  const questions: QuizQuestion[] = [];
  const usedAnswers = new Set<string>();

  for (const sentence of chosen) {
    const positions = candidatesIn(sentence).filter(
      (position) => !usedAnswers.has(fold(bareWord(sentence.words[position]!)))
    );
    if (positions.length === 0) continue;

    // A mais longa pesa mais no sentido da frase; o sorteio so desempata.
    const longest = Math.max(...positions.map((p) => letterCount(bareWord(sentence.words[p]!))));
    const heaviest = positions.filter(
      (p) => letterCount(bareWord(sentence.words[p]!)) === longest
    );
    const position = heaviest[Math.floor(next() * heaviest.length)]!;
    const answer = bareWord(sentence.words[position]!);
    const answerKey = fold(answer);
    const inSentence = new Set(sentence.words.map((token) => fold(bareWord(token))));

    // Distratores: do mesmo trecho, tamanho parecido, fora da propria frase -
    // uma alternativa que aparece ao lado da lacuna seria descartada de cara.
    const size = letterCount(answer);
    const distractors = shuffle(
      [...pool.entries()]
        .filter(
          ([key, word]) =>
            key !== answerKey &&
            !inSentence.has(key) &&
            Math.abs(letterCount(word) - size) <= LENGTH_SLACK
        )
        .map(([, word]) => word),
      next
    ).slice(0, CHOICES_PER_QUESTION - 1);
    if (distractors.length < CHOICES_PER_QUESTION - 1) continue;

    const choices = shuffle([answer, ...distractors], next);
    const token = sentence.words[position]!;
    const blanked = sentence.words.map((item, index) =>
      index === position ? token.replace(answer, BLANK) : item
    );

    usedAnswers.add(answerKey);
    questions.push({
      prompt: blanked.join(" "),
      choices,
      answer: choices.indexOf(answer),
      evidence: sentence.words.join(" "),
    });
  }

  return questions;
}

/**
 * Palavra de maior peso lexical num trecho: a lacuna da revisao de destaques
 * (PROD-4). Mesmo criterio das perguntas - a palavra de conteudo mais longa,
 * sem nome proprio -, com um piso menor, porque um destaque curto pode nao ter
 * palavra de seis letras. Nulo quando nada serve; ai a revisao mostra o
 * trecho inteiro.
 */
export function heaviestWordIndex(words: string[]): number | null {
  let best: number | null = null;
  let bestSize = 0;
  words.forEach((token, index) => {
    const word = bareWord(token);
    if (!isContentWord(word, 4)) return;
    if (index > 0 && isCapitalized(word)) return;
    const size = letterCount(word);
    if (size > bestSize) {
      best = index;
      bestSize = size;
    }
  });
  return best;
}

/** Palavras minimas do trecho: menos que isso raramente rende duas frases. */
export const MIN_CLOZE_PASSAGE = 80;

/**
 * Trecho de onde saem as lacunas: o que a ultima sessao leu.
 *
 * A sessao termina na posicao salva do texto e cobriu `wordsRead` palavras;
 * voltar esse tanto a partir da posicao da o trecho lido. Sem sessao, ou com
 * a posicao no inicio, vale o texto inteiro. Trecho curto demais e alargado
 * para tras ate o minimo, porque tres perguntas de uma frase so nao medem
 * nada.
 */
export function passageRange(
  total: number,
  progress: number,
  wordsRead: number | null
): { from: number; to: number } {
  const end = Math.min(Math.max(progress, 0), total);
  if (end <= 0 || !wordsRead || wordsRead <= 0) return { from: 0, to: total };
  const from = Math.max(0, Math.min(end - wordsRead, end - MIN_CLOZE_PASSAGE));
  return { from, to: end };
}
