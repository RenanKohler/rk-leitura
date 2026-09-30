import { config } from "dotenv";
import { Client } from "pg";

/**
 * Acesso direto ao banco para os testes que dependem da passagem do tempo:
 * revisao vencida, capitulo concluido ha dois dias. Nenhuma rota deixa
 * escrever datas no passado, e esperar de verdade nao cabe num teste.
 */
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

export async function runSql(query: string, params: unknown[] = []): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(query, params);
  } finally {
    await client.end();
  }
}
