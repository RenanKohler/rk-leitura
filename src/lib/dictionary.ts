/**
 * Consulta de palavras durante a leitura.
 *
 * A definicao vem com a frase em volta: "manga" em um texto de botanica e
 * outra coisa que em um de costura, e sem o contexto o painel acertaria
 * metade das vezes. E tambem o que resolve o criterio da forma flexionada -
 * "percorreram" nao precisa de uma lista de conjugacoes para virar "percorrer".
 *
 * Funcoes puras, compartilhadas entre servidor e cliente.
 */

export const MAX_WORD_CHARS = 60;
export const MAX_CONTEXT_CHARS = 400;

/** Palavras guardadas por conta: acima disso a lista deixa de ser util. */
export const MAX_SAVED_WORDS = 500;

export interface WordEntry {
  /** A palavra como ela aparece no texto. */
  word: string;
  /** Forma de dicionario: infinitivo, singular, masculino. */
  base: string;
  /** Classe gramatical no uso daquela frase. */
  kind: string;
  /** Definicao curta, no sentido em que a palavra foi usada. */
  definition: string;
  /** Traducao para o portugues, quando a palavra e de outro idioma (US-69). */
  translation?: string | null;
}

/**
 * Limpa a palavra tocada.
 *
 * Tira pontuacao e aspas das pontas, mas preserva hifen e apostrofo internos:
 * "guarda-chuva" e uma palavra so, e "d'agua" tambem.
 */
export function normalizeWord(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const word = raw
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "")
    .slice(0, MAX_WORD_CHARS);

  return /\p{L}/u.test(word) ? word : null;
}

/** Forma comparavel: minuscula e sem acento, como no resto do app. */
export function wordKey(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Recorte da frase em volta, para o modelo saber em que sentido responder. */
export function trimContext(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_CONTEXT_CHARS);
}

/**
 * Extrai a palavra que contem a posicao `offset` dentro de `text`.
 *
 * Usada para descobrir o que foi tocado sem envolver cada palavra em um
 * elemento proprio: e o que mantem a quebra de pagina identica a de hoje,
 * porque o texto no DOM continua sendo um no de texto so.
 */
export function wordAround(text: string, offset: number): string | null {
  if (typeof text !== "string" || text.length === 0) return null;

  const raw = Math.max(0, Math.min(text.length - 1, Math.trunc(offset)));
  const isWord = (char: string | undefined) => Boolean(char) && /[\p{L}\p{N}'’-]/u.test(char!);

  // Um toque no fim da palavra costuma cair na virgula ou no ponto seguinte.
  // Olhar uma posicao atras transforma isso na palavra que o dedo mirou, em
  // vez de em nada.
  const at = isWord(text[raw]) ? raw : raw > 0 && isWord(text[raw - 1]) ? raw - 1 : -1;
  if (at === -1) return null;

  let start = at;
  while (start > 0 && isWord(text[start - 1])) start -= 1;

  let end = at;
  while (end < text.length - 1 && isWord(text[end + 1])) end += 1;

  return normalizeWord(text.slice(start, end + 1));
}

/** Frase em volta do recorte, para dar contexto sem mandar o texto inteiro. */
export function sentenceAround(text: string, offset: number, span = 160): string {
  const at = Math.max(0, Math.min(text.length, Math.trunc(offset)));
  return trimContext(text.slice(Math.max(0, at - span), at + span));
}

/** Aceita apenas o que a tela consegue mostrar. */
export function parseEntry(raw: unknown, word: string): WordEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  const definition = asText(item.definition);
  if (!definition) return null;

  return {
    word,
    base: asText(item.base) ?? word,
    kind: asText(item.kind) ?? "",
    definition,
    translation: asText(item.translation),
  };
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = unescapeUnicode(value).replace(/\s+/g, " ").trim();
  return clean.length > 0 ? clean.slice(0, 400) : null;
}

/**
 * Decodifica sequencias `\uXXXX` que sobraram como texto.
 *
 * O modelo as vezes escreve o escape em vez do caractere, e a definicao chega
 * com "bra\u00e7o" no lugar de "braço". Decodificar aqui, na fronteira, e o
 * que impede isso de ser gravado e exibido assim.
 */
export function unescapeUnicode(value: string): string {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (whole, hex) => {
    const code = parseInt(hex, 16);
    // Substituto solto nao forma caractere; melhor deixar como estava.
    return code >= 0xd800 && code <= 0xdfff ? whole : String.fromCharCode(code);
  });
}
