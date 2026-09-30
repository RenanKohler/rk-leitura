import "server-only";

import { db } from "@/db";
import { speedSettings } from "@/db/schema";

/**
 * Escrita na linha de preferencias de uma conta.
 *
 * `db.update(speedSettings)` nao falha quando a linha nao existe: atualiza
 * zero linhas e segue. Contas criadas antes de o cadastro gravar essa linha
 * aceitavam a sugestao do teste de nivelamento, recebiam "aplicado" e
 * continuavam lendo na velocidade padrao. Toda escrita parcial passa por aqui
 * e vira insert com `onConflictDoUpdate`: se a linha falta, ela nasce.
 */

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type SettingsPatch = Partial<Omit<typeof speedSettings.$inferInsert, "id" | "userId">>;

/**
 * Valores de uma linha nova que diferem do padrao das colunas.
 *
 * O descanso da vista (PROD-16) passou a ser ligado para contas novas, mas o
 * padrao da coluna continua o da migration: mudar o schema e de quem cuida
 * das migrations. Por isso o valor vai explicito em toda linha criada aqui.
 */
export const NEW_ROW_DEFAULTS = { eyeRest: true } satisfies SettingsPatch;

export async function upsertSettings(
  executor: Executor,
  userId: string,
  patch: SettingsPatch
): Promise<void> {
  await executor
    .insert(speedSettings)
    .values({ ...NEW_ROW_DEFAULTS, ...patch, userId })
    .onConflictDoUpdate({
      target: speedSettings.userId,
      set: { ...patch, updatedAt: new Date() },
    });
}
