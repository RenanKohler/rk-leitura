/**
 * O que a IA gerou e ficou guardado na conta (US-143, US-193). Funcoes
 * puras: a contagem por tipo e o texto da confirmacao.
 */

export interface StoredAiCounts {
  /** Explicacoes, resumos, sinopses e demais linhas de `ai_results`. */
  resultados: number;
  /** Perguntas feitas aos textos (`ask_turns`). */
  perguntas: number;
  /** Cartoes de estudo gerados e nao editados. */
  cartoes: number;
  /** Analogias guardadas nos cartoes. */
  analogias: number;
  /** Cartoes gerados a partir de destaques. */
  cartoesDestaque: number;
  /** Questionarios de compreensao gerados. */
  questionarios: number;
  /** Cartoes gerados que o leitor editou: ficam. */
  cartoesEditados: number;
}

/** Itens que a exclusao leva (os editados ficam fora da conta). */
export function storedTotal(counts: StoredAiCounts): number {
  return (
    counts.resultados +
    counts.perguntas +
    counts.cartoes +
    counts.analogias +
    counts.cartoesDestaque +
    counts.questionarios
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "3 resultados guardados, 1 pergunta, 5 cartões de estudo": so os tipos com itens. */
export function storedBreakdown(counts: StoredAiCounts): string {
  const parts = [
    counts.resultados > 0 && plural(counts.resultados, "resultado guardado", "resultados guardados"),
    counts.perguntas > 0 && plural(counts.perguntas, "pergunta ao texto", "perguntas aos textos"),
    counts.cartoes > 0 && plural(counts.cartoes, "cartão de estudo", "cartões de estudo"),
    counts.analogias > 0 && plural(counts.analogias, "analogia", "analogias"),
    counts.cartoesDestaque > 0 &&
      plural(counts.cartoesDestaque, "cartão de destaque", "cartões de destaque"),
    counts.questionarios > 0 && plural(counts.questionarios, "questionário", "questionários"),
  ].filter((part): part is string => Boolean(part));
  return parts.join(", ");
}

/** Antes de confirmar: quantos cartoes editados ficam. */
export function keepsEditedNotice(kept: number): string {
  return kept === 1 ? "1 cartão editado por você fica." : `${kept} cartões editados por você ficam.`;
}

/** Aviso dos cartoes gerados e editados, que a exclusao mantem. */
export function keptEditedNotice(kept: number): string | null {
  if (kept <= 0) return null;
  return kept === 1
    ? "1 cartão editado por você foi mantido."
    : `${kept} cartões editados por você foram mantidos.`;
}
