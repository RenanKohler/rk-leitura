import "../lib/load-env";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, getPool } from "./index";

/**
 * Cria a linha de preferencias das contas que nao tem uma (APP-1).
 *
 * O cadastro antigo nao gravava `speed_settings`, e as escritas parciais
 * nessa tabela (teste de nivelamento, treino, lembrete) eram `update`: em
 * conta sem linha, atualizavam zero linhas sem erro. O codigo agora faz
 * upsert, mas a linha que falta ainda muda o comportamento de quem le as
 * preferencias por consulta direta. Idempotente: roda em todo deploy e, depois
 * da primeira vez, nao encontra ninguem sem linha.
 *
 * Fica aqui, e nao numa migration drizzle, porque e dado e nao schema: a
 * pasta de migrations e de quem cuida do schema. `eye_rest` vai ligado porque
 * e o padrao atual de conta nova (PROD-16), e era o que essas contas ja viam
 * - sem linha, a leitura caia no padrao do codigo.
 */
async function backfillSpeedSettings(): Promise<number> {
  const result = await db.execute(sql`
    insert into speed_settings (user_id, eye_rest)
    select u.id, true
    from users u
    where not exists (select 1 from speed_settings s where s.user_id = u.id)
    on conflict (user_id) do nothing
  `);
  return result.rowCount ?? 0;
}

async function main() {
  console.log("Aplicando migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations aplicadas.");

  // Depois das migrations: num banco novo a tabela ainda nao existe antes delas.
  const filled = await backfillSpeedSettings();
  if (filled > 0) console.log(`Preferencias criadas para ${filled} conta(s) sem linha.`);

  await getPool().end();
}

main().catch((error) => {
  console.error("Falha ao aplicar migrations:", error);
  process.exit(1);
});
