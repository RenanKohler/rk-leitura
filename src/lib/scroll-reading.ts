/**
 * Leitura em rolagem continua: o texto inteiro numa coluna que o leitor
 * arrasta, em vez de paginas.
 *
 * Aqui ficam as contas puras. Quem le a tela (posicao da rolagem, caixa da
 * palavra) e o `useScrollReading`.
 */

import type { Paragraph } from "@/lib/reading";
import type { StoredHighlight } from "@/lib/highlights";

/** Tempo sem evento de rolagem ate a posicao ser dada como parada. */
export const SCROLL_SETTLE_MS = 140;

/**
 * Indice, na lista, do paragrafo que contem a palavra. Fora do texto, devolve
 * o paragrafo mais proximo; lista vazia devolve -1.
 */
export function paragraphIndexOf(paragraphs: Paragraph[], wordIndex: number): number {
  let low = 0;
  let high = paragraphs.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (paragraphs[middle]!.start <= wordIndex) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found === -1 && paragraphs.length > 0 ? 0 : found;
}

/**
 * Onde a palavra de numero `position` (a partir de 0) comeca e termina dentro
 * de `text`, em caracteres. A contagem e a mesma da selecao: palavras sao o
 * que sobra entre espacos.
 */
export function wordSpanInText(
  text: string,
  position: number
): { start: number; end: number } | null {
  if (!Number.isInteger(position) || position < 0) return null;
  const pattern = /\S+/g;
  let count = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (count === position) return { start: match.index, end: match.index + match[0].length };
    count += 1;
  }
  return null;
}

const NO_MARKS: StoredHighlight[] = [];

/**
 * Destaques de cada paragrafo, pela palavra inicial dele.
 *
 * Na rolagem todos os paragrafos ficam montados. Dar a cada um so os seus
 * destaques, numa lista que nao muda enquanto eles nao mudam, deixa o React
 * pular os paragrafos que nao tem nada a redesenhar.
 */
export function marksByParagraph(
  paragraphs: Paragraph[],
  marks: StoredHighlight[]
): (paragraph: Paragraph) => StoredHighlight[] {
  const byStart = new Map<number, StoredHighlight[]>();
  if (marks.length > 0) {
    for (const paragraph of paragraphs) {
      const end = paragraph.start + paragraph.words.length;
      const own = marks.filter((mark) => mark.start < end && mark.end > paragraph.start);
      if (own.length > 0) byStart.set(paragraph.start, own);
    }
  }
  return (paragraph) => byStart.get(paragraph.start) ?? NO_MARKS;
}

/**
 * A palavra esta a vista na coluna rolada?
 *
 * Em cima basta aparecer um pedaco da linha: e onde a rolagem do leitor
 * costuma parar, e ajustar ali faria o texto pular depois de cada arraste.
 * Embaixo a linha precisa caber inteira, para o guia e a narracao nao
 * seguirem por uma linha cortada.
 */
export function wordInView(
  word: { top: number; bottom: number },
  frame: { top: number; bottom: number }
): boolean {
  return word.bottom > frame.top && word.bottom <= frame.bottom + 1;
}

/**
 * Palavras de distancia a partir das quais a rolagem deixou para tras o
 * lugar onde a leitura estava (cerca de uma tela de celular).
 */
export const SCROLL_AWAY_WORDS = 250;

/**
 * A posicao rolada esta longe do lugar onde a leitura parou?
 *
 * Medida em palavras, nao em paginas: as paginas mudam com a altura do
 * quadro, que muda quando os controles saem da tela. Com a conta em paginas,
 * o atalho "voltar para onde parou" aparecia numa altura e sumia na outra, e
 * como ele segura os controles na tela, os dois ficavam se alternando e o
 * texto tremia.
 */
export function scrolledAway(index: number, anchor: number): boolean {
  return Math.abs(index - anchor) > SCROLL_AWAY_WORDS;
}

/**
 * Linha de estado da rolagem: nao ha pagina para contar. So o numero, porque
 * a barra divide a linha com outros botoes e um rotulo maior e cortado.
 */
export function scrollStatus(index: number, total: number): string {
  if (total <= 0) return "0%";
  const percent = Math.min(100, Math.max(0, Math.round((index / total) * 100)));
  return `${percent}%`;
}
