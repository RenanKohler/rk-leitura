/**
 * Regras do acompanhamento de series e feeds (US-70, US-71).
 *
 * Puras, para os limites e a pausa serem testados sem banco nem rede.
 */

/** Series acompanhadas por conta: protege o tempo de execucao da rotina. */
export const MAX_FOLLOWED_SERIES = 10;

/** Feeds assinados por conta. */
export const MAX_FEEDS = 5;

/** Itens novos importados de um feed a cada verificacao. */
export const MAX_FEED_ITEMS_PER_CHECK = 5;

/** Cada fonte e consultada no maximo uma vez neste intervalo. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Falhas seguidas da origem antes de pausar. */
export const MAX_FAILURES = 3;

export const PAUSED_MESSAGE = "Acompanhamento pausado: a origem nao respondeu";

/** Fonte ativa e sem verificacao recente. */
export function shouldCheck(
  source: { lastCheckedAt: Date | null; pausedAt: Date | null },
  now: Date
): boolean {
  if (source.pausedAt) return false;
  if (!source.lastCheckedAt) return true;
  return now.getTime() - source.lastCheckedAt.getTime() >= CHECK_INTERVAL_MS;
}

/**
 * Resultado de uma verificacao.
 *
 * "Nada novo" nao e falha: capitulo ainda nao publicado e o caso comum. So a
 * origem que nao responde conta, e a terceira seguida pausa.
 */
export type CheckOutcome = "novo" | "nada" | "falha";

export function afterCheck(
  failures: number,
  outcome: CheckOutcome
): { failures: number; paused: boolean } {
  if (outcome !== "falha") return { failures: 0, paused: false };
  const next = failures + 1;
  return { failures: next, paused: next >= MAX_FAILURES };
}
