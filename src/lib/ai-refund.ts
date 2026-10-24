import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { AiUnavailable, type AiTask } from "@/lib/ai";
import { releaseDailyQuota } from "@/lib/daily-quota";
import type { QuotaKind } from "@/lib/quota";
import { logError } from "@/lib/error-log";

/**
 * A falha devolve a cota (US-195)? Tempo esgotado, erro da API e resposta que
 * nao passou na validacao devolvem: o leitor nao recebeu nada e pode tentar de
 * novo. A recusa do modelo nao devolve - pedir de novo daria o mesmo -, e
 * qualquer outro erro (do proprio app) fica de fora para nao mascarar defeito.
 */
export function refundsQuota(error: unknown): error is AiUnavailable {
  return error instanceof AiUnavailable && !error.refusal;
}

/**
 * Marca como "invalida" a ultima chamada registrada da funcao, se ela ainda
 * consta como sucesso: a API respondeu, mas a validacao do app nao deixou
 * nada passar (US-195). So a ultima linha e olhada, para nunca reclassificar
 * uma chamada antiga.
 */
export async function markLastInvalid(userId: string, task: AiTask): Promise<void> {
  try {
    await db.execute(sql`
      update ai_usage set outcome = 'invalida'
       where id = (select id from ai_usage
                    where user_id = ${userId} and feature = ${task}
                    order by created_at desc limit 1)
         and outcome = 'sucesso'`);
  } catch (error) {
    logError("ia/marcar-invalida", error);
  }
}

export interface ChargedCall {
  userId: string;
  task: AiTask;
  quota: QuotaKind;
  /** Unidades descontadas; 1 quando omitido. */
  units?: number;
}

/**
 * Acerta a cota depois de uma geracao que falhou, ja com a cota descontada
 * (US-195): devolve as unidades e, se a resposta veio e nao serviu, marca o
 * registro de uso. Nunca lanca - a rota ainda precisa responder o erro.
 */
export async function settleFailedCall(error: unknown, call: ChargedCall): Promise<void> {
  if (!refundsQuota(error)) return;
  try {
    await releaseDailyQuota(call.quota, call.userId, call.units ?? 1);
  } catch (failure) {
    logError("ia/devolver-cota", failure);
  }
  if (error.invalid) await markLastInvalid(call.userId, call.task);
}
