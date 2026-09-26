/**
 * Remapear posicoes quando o texto de um registro muda por remocao de
 * trechos - como omitir as referencias de um texto ja salvo.
 *
 * Posicao de leitura, destaques e marcadores sao indices de palavra. Tirar
 * "[12]" do meio do texto desloca todos os indices depois dele; sem o
 * remapeamento, o destaque passaria a cobrir outras palavras.
 *
 * Funcoes puras, testaveis sem banco.
 */

function key(word: string): string {
  return word
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Casa cada palavra da lista curta com uma da lista longa, na ordem.
 *
 * A lista curta e a longa sem algumas palavras (as citacoes), e algumas
 * palavras da curta perderam pontuacao ou um sobrescrito colado: "vez [1]."
 * vira "vez.", "resultado¹²" vira "resultado". Por isso a comparacao e pela
 * forma sem pontuacao, aceitando que uma seja o comeco da outra.
 *
 * Devolve, para cada palavra da lista curta, o indice dela na longa - ou
 * null quando nem todas casam, e remapear seria adivinhar.
 */
export function alignRemoval(longer: string[], shorter: string[]): number[] | null {
  const matched: number[] = [];
  let i = 0;

  for (const word of shorter) {
    const wanted = key(word);
    while (i < longer.length) {
      const candidate = key(longer[i]!);
      const same =
        candidate === wanted ||
        (wanted.length > 0 && candidate.length > 0 && (candidate.startsWith(wanted) || wanted.startsWith(candidate)));
      i += 1;
      if (same) {
        matched.push(i - 1);
        break;
      }
    }
    if (matched.length === 0 || matched[matched.length - 1] !== i - 1) return null;
  }

  return matched;
}

/**
 * Tabela de posicao antiga -> nova, com uma entrada a mais para o fim do
 * texto. Palavra removida aponta para a primeira que ficou depois dela.
 */
export function forwardMap(oldLength: number, matched: number[]): number[] {
  const map = new Array<number>(oldLength + 1);
  let next = 0;
  for (let old = 0; old <= oldLength; old += 1) {
    while (next < matched.length && matched[next]! < old) next += 1;
    map[old] = next;
  }
  return map;
}

/** Posicao nova -> antiga, para desfazer: o inverso direto do casamento. */
export function inverseMap(matched: number[], oldLength: number): number[] {
  return [...matched, oldLength];
}

export interface Span {
  start: number;
  end: number;
}

/**
 * Intervalo `[start, end)` levado para a lista nova. Some quando todas as
 * palavras dele foram removidas: um destaque so da citacao nao tem mais o
 * que marcar.
 */
export function mapSpan(span: Span, map: number[]): Span | null {
  const start = map[span.start]!;
  const end = map[span.end]!;
  return end > start ? { start, end } : null;
}

/**
 * Intervalo levado de volta ao texto original. O fim e a palavra seguinte a
 * ultima do intervalo: citacoes que estavam no meio voltam para dentro dele.
 */
export function unmapSpan(span: Span, inverse: number[]): Span | null {
  if (span.end <= span.start) return null;
  const start = inverse[span.start]!;
  const end = inverse[span.end - 1]! + 1;
  return end > start ? { start, end } : null;
}
