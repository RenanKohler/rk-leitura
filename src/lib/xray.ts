/**
 * X-Ray local (PROD-11): os nomes proprios de um texto, sem modelo de
 * linguagem.
 *
 * Um nome e uma sequencia de palavras com inicial maiuscula. O problema e o
 * comeco de frase, onde toda palavra e maiuscula: "Depois", "Quando", "Ela".
 * A regra evita o palpite: so vira nome o que aparece maiusculo em algum
 * ponto que NAO e comeco de frase. Descoberto o nome, as ocorrencias em
 * comeco de frase tambem contam - "Capitu sorriu." e a mesma Capitu. Entram
 * so os nomes com 3 ou mais ocorrencias: menos que isso e figurante, ou
 * ruido.
 *
 * Funcoes puras, compartilhadas entre servidor e cliente.
 */

import type { Paragraph } from "@/lib/reading";

/** Ocorrencias minimas para o nome entrar na lista. */
export const MIN_NAME_OCCURRENCES = 3;
/** Indices guardados por nome: o painel mostra as primeiras. */
export const MAX_NAME_POSITIONS = 20;
/** Palavras no maximo por nome: "Maria da Gloria Fernandes" cabe. */
const MAX_NAME_WORDS = 4;

/** Particulas que ligam partes de um nome: "Maria da Silva", "Jose de Alencar". */
const CONNECTORS = new Set(["da", "de", "do", "das", "dos", "del", "van", "von", "di"]);

export interface NameEntry {
  /** O nome como aparece no texto, sem pontuacao. */
  name: string;
  /** Ocorrencias no texto inteiro. */
  count: number;
  /** Indices (palavra inicial) das primeiras ocorrencias, em ordem. */
  positions: number[];
}

function bare(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** Inicial maiuscula seguida de ao menos uma minuscula: "Ana" sim, "ONU" e "A" nao. */
function isNameWord(word: string): boolean {
  return /^\p{Lu}[\p{Ll}'’-]*\p{Ll}[\p{L}'’-]*$/u.test(word);
}

/** Pontuacao que fecha frase no fim do token. */
function closesSentence(token: string): boolean {
  return /[.!?…:]["'”’»)\]]*$/.test(token);
}

/** Pontuacao no fim do token que interrompe o nome ("Ana, Pedro"). */
function breaksName(token: string): boolean {
  return /[^\p{L}\p{N}]$/u.test(token);
}

/** Travessao ou aspas abrindo a fala tambem comecam frase. */
function opensSpeech(token: string): boolean {
  return /^[—–-]$/.test(token) || /^[«"“]/.test(token);
}

/**
 * Posicoes em que uma frase comeca: inicio de paragrafo, depois de ponto
 * final e depois de travessao de dialogo.
 */
function sentenceStarts(words: string[], paragraphs: Paragraph[]): Set<number> {
  const starts = new Set<number>([0]);
  for (const paragraph of paragraphs) starts.add(paragraph.start);
  words.forEach((token, index) => {
    if (closesSentence(token) || /^[—–-]$/.test(token)) starts.add(index + 1);
    // Fala que abre com aspas coladas: a palavra depois delas comeca frase.
    if (opensSpeech(token) && bare(token) !== "") starts.add(index);
  });
  return starts;
}

/**
 * Le a sequencia de nome que comeca em `index`, ou null. Particulas so
 * entram entre duas palavras maiusculas, e pontuacao encerra o nome.
 */
function readName(words: string[], index: number): { name: string; length: number } | null {
  const first = bare(words[index] ?? "");
  if (!isNameWord(first)) return null;

  const parts = [first];
  let length = 1;
  let cursor = index;
  while (parts.length < MAX_NAME_WORDS && !breaksName(words[cursor]!)) {
    const next = bare(words[cursor + 1] ?? "");
    // A palavra seguinte nao pode abrir com pontuacao: aspas ou parenteses
    // abrindo sao outra coisa, nao o sobrenome.
    if (isNameWord(next) && /^\p{L}/u.test(words[cursor + 1]!)) {
      parts.push(next);
      cursor += 1;
      length = cursor - index + 1;
      continue;
    }
    // Particula entre duas maiusculas: "Maria da Silva".
    const after = bare(words[cursor + 2] ?? "");
    if (
      CONNECTORS.has(next) &&
      words[cursor + 1] === next &&
      isNameWord(after) &&
      parts.length + 2 <= MAX_NAME_WORDS
    ) {
      parts.push(next, after);
      cursor += 2;
      length = cursor - index + 1;
      continue;
    }
    break;
  }
  return { name: parts.join(" "), length };
}

/**
 * Nomes proprios do texto com contagem e indices das primeiras ocorrencias,
 * do mais citado ao menos.
 *
 * Duas passadas: a primeira descobre os nomes pelas ocorrencias fora de
 * comeco de frase; a segunda conta todas as ocorrencias deles, inclusive em
 * comeco de frase. Uma ocorrencia que comeca dentro de outro nome ja contado
 * ("Silva" dentro de "Maria da Silva") nao conta de novo.
 */
export function namesInText(words: string[], paragraphs: Paragraph[]): NameEntry[] {
  const starts = sentenceStarts(words, paragraphs);

  const known = new Set<string>();
  for (let index = 0; index < words.length; index += 1) {
    if (starts.has(index)) continue;
    // Continuacao de um nome que comecou na palavra anterior nao abre outro.
    const previous = words[index - 1];
    if (previous !== undefined && !breaksName(previous) && isNameWord(bare(previous))) continue;
    const found = readName(words, index);
    if (found) known.add(found.name);
  }
  if (known.size === 0) return [];

  const entries = new Map<string, NameEntry>();
  for (let index = 0; index < words.length; index += 1) {
    const found = readName(words, index);
    if (!found) continue;

    // O nome mais longo conhecido a partir daqui: "Maria da Silva" antes de
    // "Maria", quando os dois existem.
    let match: { name: string; length: number } | null = known.has(found.name) ? found : null;
    if (!match) {
      const parts = found.name.split(" ");
      for (let size = parts.length - 1; size >= 1 && !match; size -= 1) {
        const candidate = parts.slice(0, size).join(" ");
        if (known.has(candidate) && !CONNECTORS.has(parts[size - 1]!)) {
          match = { name: candidate, length: size };
        }
      }
    }
    if (!match) continue;

    const entry = entries.get(match.name) ?? { name: match.name, count: 0, positions: [] };
    entry.count += 1;
    if (entry.positions.length < MAX_NAME_POSITIONS) entry.positions.push(index);
    entries.set(match.name, entry);
    index += match.length - 1;
  }

  return [...entries.values()]
    .filter((entry) => entry.count >= MIN_NAME_OCCURRENCES)
    .sort((a, b) => b.count - a.count || a.positions[0]! - b.positions[0]!);
}

/** Trecho em volta de uma ocorrencia, para o painel mostrar o contexto. */
export function contextAround(words: string[], index: number, before = 6, after = 8): string {
  const from = Math.max(0, index - before);
  const to = Math.min(words.length, index + after);
  return `${from > 0 ? "..." : ""}${words.slice(from, to).join(" ")}${to < words.length ? "..." : ""}`;
}
