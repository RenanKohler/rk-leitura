/**
 * Sinopse sem spoiler de um texto parado na biblioteca (US-138). Funcoes
 * puras, com teste.
 *
 * Sem spoiler por construcao: o modelo so recebe o comeco do texto, e a regra
 * e garantida aqui, na montagem do recorte, e nao pedida a ele.
 */

/** Parte do texto enviada: os primeiros 15%. */
export const SYNOPSIS_SHARE = 0.15;

/** Teto do recorte, em caracteres, mesmo em livro inteiro. */
export const MAX_SYNOPSIS_CHARS = 20_000;

/** Abaixo disso o texto se le em um minuto: a sinopse nao vale a chamada. */
export const MIN_SYNOPSIS_WORDS = 200;

/** Tamanho maximo da sinopse mostrada. */
export const MAX_SYNOPSIS_WORDS = 50;

/** A opcao aparece so em texto nao iniciado e longo o bastante. */
export function canAskSynopsis(text: { wordCount: number; progressIndex: number }): boolean {
  return text.progressIndex === 0 && text.wordCount >= MIN_SYNOPSIS_WORDS;
}

/**
 * Os primeiros 15% das palavras, na grafia original (paragrafos inclusos),
 * cortados no teto de caracteres no ultimo espaco antes dele.
 */
export function synopsisExcerpt(
  content: string,
  share: number = SYNOPSIS_SHARE,
  maxChars: number = MAX_SYNOPSIS_CHARS
): string {
  const ends: number[] = [];
  for (const match of content.matchAll(/\S+/g)) ends.push(match.index + match[0].length);
  if (ends.length === 0) return "";

  const wanted = Math.max(1, Math.ceil(ends.length * share));
  let end = ends[wanted - 1]!;
  if (end > maxChars) {
    // Ultima palavra inteira que cabe no teto.
    let fit = 0;
    for (const value of ends) {
      if (value > maxChars) break;
      fit = value;
    }
    end = fit > 0 ? fit : maxChars;
  }
  return content.slice(0, end).trim();
}

/** Garante o teto de palavras da sinopse, fechando com reticencias se cortou. */
export function clampSynopsis(raw: string, maxWords: number = MAX_SYNOPSIS_WORDS): string {
  const words = raw.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ").replace(/[.,;:!?…]+$/, "")}…`;
}
