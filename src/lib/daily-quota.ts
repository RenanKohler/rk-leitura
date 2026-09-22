import "server-only";

import { todayIn } from "@/lib/goals";
import { loadSettings } from "@/lib/queries";
import { DAILY_QUOTAS, quotaKey, secondsUntilNextDay, type QuotaKind } from "@/lib/quota";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Consome uma unidade da cota diaria da conta.
 *
 * A janela do contador vai ate a meia-noite no fuso do usuario, com folga de
 * uma hora: a chave ja muda na virada, a folga so evita que a linha suma antes
 * do ultimo pedido do dia ser contado.
 */
export async function consumeDailyQuota(
  kind: QuotaKind,
  userId: string
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const timezone = (await loadSettings(userId))?.timezone ?? "UTC";
  const now = new Date();
  const remaining = secondsUntilNextDay(timezone, now);

  const result = await rateLimit(
    quotaKey(kind, userId, todayIn(timezone, now)),
    DAILY_QUOTAS[kind],
    (remaining + 3600) * 1000
  );
  return { allowed: result.allowed, retryAfterSeconds: result.allowed ? 0 : remaining };
}
