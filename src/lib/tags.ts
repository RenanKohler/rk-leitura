/**
 * Etiquetas da biblioteca.
 *
 * Classificacao manual, ao contrario da serie (US-37), que e sequencia
 * automatica. As duas convivem no mesmo texto e respondem a perguntas
 * diferentes: "que tipo de leitura e esta" e "qual e o proximo capitulo".
 *
 * Funcoes puras, compartilhadas entre servidor e cliente.
 */

import { foldForSearch } from "@/lib/text-filter";

export const MAX_TAG_CHARS = 30;

/**
 * Teto de etiquetas por texto.
 *
 * Nao e limite de banco: e o que cabe no cartao da biblioteca sem empurrar o
 * titulo para fora da tela no celular.
 */
export const MAX_TAGS_PER_TEXT = 8;

/** Teto de etiquetas por conta, contra criacao acidental em laco. */
export const MAX_TAGS_PER_USER = 200;

/**
 * Nome como ele e guardado: sem espaco sobrando e no tamanho maximo.
 *
 * A caixa digitada e preservada - "Ficcao" e "ficcao" sao a mesma etiqueta na
 * comparacao, mas quem escreveu com maiuscula ve a maiuscula de volta.
 */
export function normalizeTagName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_CHARS);
  return name.length > 0 ? name : null;
}

/** Forma usada para comparar: mesma dobra de acento da busca da biblioteca. */
export function tagKey(name: string): string {
  return foldForSearch(name);
}

/** Verdadeiro quando os dois nomes designam a mesma etiqueta. */
export function sameTag(a: string, b: string): boolean {
  return tagKey(a) === tagKey(b);
}

/**
 * Lista de nomes vinda da tela, pronta para gravar.
 *
 * Remove repeticoes pela chave de comparacao, nao pelo texto: digitar
 * "Estudo" e "estudo" cria uma etiqueta, nao duas que a tela mostraria lado a
 * lado como se fossem diferentes.
 */
export function normalizeTagList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const item of raw) {
    const name = normalizeTagName(item);
    if (!name) continue;

    const key = tagKey(name);
    if (seen.has(key)) continue;

    seen.add(key);
    names.push(name);
    if (names.length >= MAX_TAGS_PER_TEXT) break;
  }

  return names;
}

/** Ordem de exibicao: alfabetica pela forma dobrada, para ignorar acento. */
export function sortTags<T extends { name: string }>(tags: T[]): T[] {
  return [...tags].sort((a, b) => tagKey(a.name).localeCompare(tagKey(b.name)));
}
