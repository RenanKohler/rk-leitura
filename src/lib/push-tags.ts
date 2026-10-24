/**
 * Tags das notificacoes (US-201).
 *
 * O navegador substitui a notificacao visivel que tem a mesma tag. Com uma tag
 * fixa no service worker, o lembrete de revisao apagava o de leitura enviado
 * segundos antes. Cada tipo tem a sua; payload sem tag (servidor antigo) cai
 * em `lembrete-diario` no `sw.js`.
 */
export const PUSH_TAGS = {
  leitura: "lembrete-leitura",
  revisao: "lembrete-revisao",
  capitulo: "capitulo-novo",
  feed: "feed-novo",
} as const;

export const DEFAULT_PUSH_TAG = "lembrete-diario";
