/**
 * O que a exportacao "Conta completa" leva (US-189), tabela por tabela.
 *
 * E a portabilidade da LGPD, par da exclusao de conta (US-07): o que a conta
 * guarda precisa poder sair. Cada tabela do schema esta em uma das duas
 * listas; um teste falha quando aparece tabela nova fora delas, para a
 * exportacao nao ficar para tras sem ninguem perceber.
 */

/** Tabelas que saem no bloco `conta` do arquivo (nome no banco). */
export const ACCOUNT_EXPORT_TABLES = [
  "reading_sessions",
  "speed_settings",
  "reading_goals",
  "training_programs",
  "training_days",
  "saved_words",
  "review_answers",
  "series_follows",
  "feeds",
  "ai_results",
  "study_cards",
  "quiz_recalls",
  "ask_turns",
] as const;

/** Tabelas que nao saem nesse bloco, com o motivo. */
export const NOT_IN_ACCOUNT_EXPORT: Record<string, string> = {
  users: "nome e e-mail saem em `conta.perfil`; a senha (hash) nunca sai",
  texts: "sai em `textos`, com conteudo e metadados",
  highlights: "sai em `textos[].destaques`",
  bookmarks: "sai em `textos[].marcadores`",
  tags: "sai em `textos[].etiquetas`",
  text_tags: "sai em `textos[].etiquetas`",
  comprehension_quizzes: "cache das perguntas, refeito ao abrir o questionario",
  push_subscriptions: "chaves do navegador, validas so naquele aparelho",
  rate_limits: "contagem do limitador, sem dado da pessoa",
  recovery_codes: "credencial: so o hash fica guardado",
  auth_sessions: "sessoes de login, validas so neste servidor",
  ai_usage: "registro operacional de custo, sem conteudo",
  ai_batches: "lote em andamento no provedor de IA",
};
