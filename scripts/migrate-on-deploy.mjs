/**
 * Migrations no build da Vercel so em producao (US-204).
 *
 * Os deploys de Preview usam o mesmo banco de producao: rodar as migrations
 * de um PR ainda nao aprovado alteraria o schema do app que esta no ar. Em
 * Preview o build segue sem migrar; em Production as migrations rodam antes
 * do `next build`, como antes. Fora da Vercel (`VERCEL_ENV` ausente), o
 * comportamento anterior continua: migra.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Decide pelo ambiente. Pura, para poder ser testada. */
export function shouldMigrate(env) {
  const target = env.VERCEL_ENV?.trim();
  return !target || target === "production";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!shouldMigrate(process.env)) {
    console.log(`Migrations puladas: deploy de ${process.env.VERCEL_ENV}, so producao migra.`);
  } else {
    const result = spawnSync("npm", ["run", "db:migrate"], { stdio: "inherit" });
    process.exit(result.status ?? 1);
  }
}
