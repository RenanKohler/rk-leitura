import "server-only";

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { pushConfigured, sendPush, type PushPayload } from "@/lib/push";

/**
 * Manda a notificacao para todos os navegadores inscritos da conta.
 *
 * Devolve se ao menos um recebeu. Inscricao que o navegador descartou e
 * apagada: ela nao volta, e repetir a falha todo dia so gasta tempo.
 */
export async function notifyUser(userId: string, payload: PushPayload): Promise<boolean> {
  if (!pushConfigured()) return false;

  const targets = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  const dead: string[] = [];
  let delivered = false;

  for (const target of targets) {
    const result = await sendPush(target, payload);
    if (result === "enviada") delivered = true;
    if (result === "expirada") dead.push(target.endpoint);
  }

  if (dead.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, dead));
  }
  return delivered;
}
