import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { getConnectionString } from "@netlify/database";
import * as schema from "./schema";

type Database = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as typeof globalThis & {
  __rkLeituraPool?: Pool;
  __rkLeituraDb?: Database;
};

/**
 * Provedores gerenciados (Neon, Supabase, Railway) exigem TLS; o Postgres local
 * normalmente nao tem certificado. `sslmode` na connection string decide, e o
 * host local serve de padrao seguro quando ele nao vem informado.
 */
function resolveSsl(connectionString: string): PoolConfig["ssl"] {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return undefined;
  }

  const mode = parsed.searchParams.get("sslmode");
  if (mode === "disable") return false;
  if (mode === "no-verify" || mode === "require") return { rejectUnauthorized: false };
  if (mode === "verify-ca" || mode === "verify-full") return { rejectUnauthorized: true };

  const host = parsed.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  return isLocal ? false : { rejectUnauthorized: true };
}

/**
 * Resolve a conexao na seguinte ordem:
 *
 * 1. `DATABASE_URL` - vale para desenvolvimento local e para qualquer host
 *    (Vercel, Railway, Neon direto). Definida explicitamente, sempre vence.
 * 2. Netlify DB - a extensao Neon provisiona o banco e injeta a conexao no
 *    ambiente; `getConnectionString()` ja devolve o endpoint do branch certo
 *    (producao ou deploy preview).
 */
export function resolveConnectionString(): string {
  const explicit = process.env.DATABASE_URL;
  if (explicit && explicit.trim().length > 0) return explicit.trim();

  try {
    return getConnectionString();
  } catch {
    throw new Error(
      "Nenhuma conexao de banco disponivel. Defina DATABASE_URL (veja .env.example) " +
        "ou rode dentro da Netlify com a extensao Neon instalada."
    );
  }
}

export function getPool(): Pool {
  if (globalForDb.__rkLeituraPool) return globalForDb.__rkLeituraPool;

  const connectionString = resolveConnectionString();
  const pool = new Pool({
    connectionString,
    ssl: resolveSsl(connectionString),
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // Sem este handler uma conexao ociosa derrubada pelo provedor vira um
  // `unhandledRejection` e mata o processo.
  pool.on("error", (error) => {
    console.error("[db] erro em conexao ociosa:", error.message);
  });

  globalForDb.__rkLeituraPool = pool;
  return pool;
}

function getDb(): Database {
  if (!globalForDb.__rkLeituraDb) {
    globalForDb.__rkLeituraDb = drizzle(getPool(), { schema, casing: "snake_case" });
  }
  return globalForDb.__rkLeituraDb;
}

/**
 * Proxy preguicoso: adiar a conexao ate a primeira query permite que o build
 * do Next rode sem DATABASE_URL.
 */
export const db = new Proxy({} as Database, {
  get(_target, property, receiver) {
    return Reflect.get(getDb(), property, receiver);
  },
});
