/**
 * Qual sugestao o leitor mostra acima da barra (US-219).
 *
 * Sugestao e o aviso que o leitor pode ignorar: recapitular, checar a
 * compreensao, reduzir a velocidade. Antes cada uma tinha a sua condicao e
 * elas se empilhavam ao pausar. Agora aparece uma por vez, na ordem abaixo, e
 * nenhuma enquanto ha um aviso de estado ou um controle aberto no lugar.
 *
 * Modulo puro: o leitor diz o que esta pendente, e a regra escolhe.
 */

/** Da maior para a menor prioridade. */
export const SUGGESTION_ORDER = ["recapitular", "capitulo", "checagem", "velocidade"] as const;

export type Suggestion = (typeof SUGGESTION_ORDER)[number];

export function visibleSuggestion(input: {
  /** Sugestoes com o que mostrar agora. */
  pending: Partial<Record<Suggestion, boolean>>;
  /**
   * Ha um aviso de estado (texto largado, falha de gravacao, erro de
   * narracao, outro aparelho, voltar ao lugar), a barra de selecao ou o
   * controle de velocidade aberto: a sugestao espera.
   */
  blocked: boolean;
  /** O leitor ja respondeu ou dispensou uma sugestao nesta pausa. */
  settled: boolean;
}): Suggestion | null {
  if (input.blocked || input.settled) return null;
  return SUGGESTION_ORDER.find((suggestion) => input.pending[suggestion]) ?? null;
}
