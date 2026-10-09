/**
 * Historico de envios a IA (US-144): rotulos de cada linha de `ai_usage`.
 *
 * Funcoes puras, compartilhadas pela rota e pelos testes. O conteudo enviado
 * nao e guardado; a lista mostra so a funcao, o texto de onde saiu e quantas
 * palavras foram.
 */

/** Quantas chamadas o historico mostra. */
export const HISTORY_LIMIT = 50;

const FEATURE_LABELS: Record<string, string> = {
  questionario: "Questionário",
  dicionario: "Dicionário",
  explicacao: "Explicação de frase",
  pergunta: "Pergunta ao texto",
  resumo: "Resumo",
  sinopse: "Sinopse",
  limpeza: "Limpeza da importação",
  etiquetas: "Etiquetas da importação",
  sugestoes: "Sugestões de perguntas",
  cartoes: "Cartões de revisão",
  secoes: "Seções do documento",
  semana: "Ideias da semana",
};

/**
 * Funcoes que nao partem de um texto da biblioteca, com o que aparece no
 * lugar do titulo. As demais sempre levam um texto: sem ele, o texto foi
 * excluido depois (a chave estrangeira vira nula).
 */
const WITHOUT_TEXT: Record<string, string> = {
  dicionario: "Palavra consultada",
  limpeza: "Importação",
  etiquetas: "Importação",
  semana: "Leituras da semana",
};

export const DELETED_TEXT = "Texto excluído";
/** Linhas gravadas antes de o registro guardar o texto e as palavras. */
export const UNRECORDED_TEXT = "Texto não registrado";

const OUTCOME_LABELS: Record<string, string> = {
  sucesso: "Concluída",
  recusa: "Recusada",
  tempo: "Tempo esgotado",
  falha: "Falhou",
};

export function featureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature;
}

export function outcomeLabel(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? "Falhou";
}

/**
 * O que aparece no campo do texto. Com texto, o titulo. Sem texto, o rotulo
 * da funcao que nao usa texto, ou "Texto excluido". Uma linha sem texto e sem
 * palavras numa funcao que sempre leva texto e anterior ao registro do
 * historico: dizer que o texto foi excluido seria inventar.
 */
export function textLabel(entry: {
  feature: string;
  textTitle: string | null;
  wordsSent: number;
}): string {
  if (entry.textTitle !== null) return entry.textTitle;
  const fixed = WITHOUT_TEXT[entry.feature];
  if (fixed) return fixed;
  return entry.wordsSent > 0 ? DELETED_TEXT : UNRECORDED_TEXT;
}
