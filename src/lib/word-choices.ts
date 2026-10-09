/**
 * Revisao de palavra por multipla escolha (US-151). Funcoes puras, usadas
 * na tela de revisao e nos testes.
 *
 * As quatro definicoes - a correta e as tres erradas guardadas na consulta -
 * aparecem em ordem aleatoria, mas a mesma para a mesma palavra no mesmo dia:
 * o embaralhamento sai de uma semente, e o servidor e a tela desenham igual.
 */

import { wordKey } from "@/lib/dictionary";

export interface DefinitionChoices {
  choices: string[];
  /** Indice da definicao correta dentro de `choices`. */
  answer: number;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32: o mesmo sorteio em qualquer maquina. */
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

/**
 * A correta e as erradas, embaralhadas pela semente. Null quando nao ha as
 * tres alternativas ou a definicao esta vazia: ai a revisao e a de sempre.
 */
export function definitionChoices(
  definition: string,
  distractors: string[] | null | undefined,
  seed: string
): DefinitionChoices | null {
  const correct = definition.trim();
  if (!correct || !distractors || distractors.length !== 3) return null;
  const choices = [correct, ...distractors];
  const next = random(seed);
  for (let index = choices.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [choices[index], choices[other]] = [choices[other]!, choices[index]!];
  }
  return { choices, answer: choices.indexOf(correct) };
}

/**
 * A frase de origem dividida em volta da palavra, para marca-la. A busca
 * ignora acento e caixa e pega a palavra inteira ("rede" nao casa com
 * "redes"); sem ela na frase, null, e a tela mostra a frase sem marca.
 */
export function markWord(
  context: string,
  word: string
): { before: string; match: string; after: string } | null {
  const target = wordKey(word);
  if (!target) return null;
  const pattern = /[\p{L}\p{N}'’-]+/gu;
  for (const found of context.matchAll(pattern)) {
    if (wordKey(found[0]) !== target) continue;
    const start = found.index ?? 0;
    const end = start + found[0].length;
    return { before: context.slice(0, start), match: found[0], after: context.slice(end) };
  }
  return null;
}
