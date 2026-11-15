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
 * Rolagem automatica (US-225): fracao da altura do quadro, contada do topo,
 * em que a linha do guia ou da narracao fica enquanto a coluna anda sozinha.
 * Um terco: sobra texto ja lido em cima e o dobro, ainda por ler, embaixo.
 */
export const FOLLOW_ANCHOR_FRACTION = 1 / 3;

/**
 * Altura da rolagem que poe a linha da leitura na ancora do quadro (US-225).
 *
 * As medidas da linha e do texto sao em px do conteudo da coluna, contados
 * do topo do texto. Assim a conta nao depende de onde a coluna esta rolada
 * nem de onde o quadro esta na tela: os controles que somem e voltam
 * (US-213) mudam o topo e a altura dele, e a ancora e uma fracao dessa altura.
 *
 * `progress` e o quanto da linha ja foi lido (0 no comeco, 1 no fim). A
 * coluna sobe a altura de uma linha enquanto o guia a atravessa, em vez de
 * ficar parada e saltar na troca de linha: o alvo no fim de uma linha e o
 * mesmo do comeco da seguinte. Com 0 a conta e por linha inteira, que e o
 * passo de quem pediu movimento reduzido.
 *
 * O resultado fica entre o topo e o fundo do texto. No comeco o guia desce
 * ate a ancora antes de a coluna andar; no fim ela para no fundo, com o bloco
 * "Concluir leitura" a vista.
 */
export function followScrollTop({
  lineTop,
  lineHeight,
  progress,
  frameHeight,
  contentHeight,
  fraction = FOLLOW_ANCHOR_FRACTION,
}: {
  /** Topo da linha da palavra atual. */
  lineTop: number;
  lineHeight: number;
  /** Quanto da linha ja foi lido, de 0 a 1. */
  progress: number;
  /** Altura visivel do quadro. */
  frameHeight: number;
  /** Altura de tudo o que a coluna rola (texto e bloco do fim). */
  contentHeight: number;
  /** Altura da ancora, em fracao do quadro a partir do topo. */
  fraction?: number;
}): number {
  const along = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const wanted = lineTop + lineHeight * along - frameHeight * fraction;
  const bottom = Math.max(0, contentHeight - frameHeight);
  return Math.min(bottom, Math.max(0, wanted));
}

/**
 * Tempo em que a coluna vence cerca de dois tercos da distancia ate o alvo.
 * Curto o bastante para a linha nao escapar da ancora numa leitura rapida,
 * longo o bastante para o passo de cada palavra se dissolver num movimento so.
 */
export const FOLLOW_EASE_MS = 400;

/**
 * Distancia, em alturas do quadro, alem da qual a coluna nao desliza o
 * caminho todo: um salto da narracao para outro capitulo faria o livro
 * inteiro passar pela tela. Ela encosta a essa distancia do alvo e desliza
 * so o trecho final.
 */
export const FOLLOW_GLIDE_SCREENS = 1.5;

/** Distancia do alvo, em px, abaixo da qual a coluna e dada como chegada. */
const FOLLOW_REST_PX = 0.05;

/**
 * Proxima altura da rolagem a caminho do alvo, `elapsedMs` depois da
 * anterior (US-225).
 *
 * Aproximacao exponencial: a cada instante a coluna anda uma fracao do que
 * falta. Nunca passa do alvo, nao depende de quantos quadros a tela desenha
 * por segundo e, com o alvo andando no ritmo da leitura, vira um movimento
 * constante logo atras dele. Partindo de longe (inicio do play, volta depois
 * de um arraste) e um deslize que desacelera ao chegar, sem salto.
 */
export function followStep(
  top: number,
  target: number,
  elapsedMs: number,
  frameHeight: number
): number {
  const distance = target - top;
  if (Math.abs(distance) < FOLLOW_REST_PX) return target;
  const reach = Math.max(1, frameHeight) * FOLLOW_GLIDE_SCREENS;
  const from = Math.abs(distance) > reach ? target - Math.sign(distance) * reach : top;
  const eased = 1 - Math.exp(-Math.max(0, elapsedMs) / FOLLOW_EASE_MS);
  return from + (target - from) * eased;
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
