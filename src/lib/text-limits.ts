/**
 * Tamanho maximo de um texto da biblioteca (US-179).
 *
 * O mesmo em toda entrada: colar, importar por URL, compartilhar, feed,
 * capitulo de serie e continuacao. Um texto acima dele nao podia nem ter o
 * titulo editado, porque o editor reenviava o conteudo inteiro.
 */
export const MAX_CONTENT_CHARS = 400_000;

export const TEXT_TOO_LARGE = "O texto é grande demais.";

/** Aviso das importacoes que cortam no limite em vez de recusar. */
export const TRUNCATED_NOTICE = "Texto cortado em 400 mil caracteres.";

/**
 * Corta o conteudo no limite, no ultimo espaco antes dele para nao partir
 * uma palavra ao meio.
 */
export function capContent(content: string): { content: string; truncated: boolean } {
  if (content.length <= MAX_CONTENT_CHARS) return { content, truncated: false };
  const cut = content.slice(0, MAX_CONTENT_CHARS);
  const space = cut.search(/\s\S*$/);
  return { content: (space > MAX_CONTENT_CHARS * 0.9 ? cut.slice(0, space) : cut).trimEnd(), truncated: true };
}
