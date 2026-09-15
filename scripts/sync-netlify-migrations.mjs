/**
 * Deriva netlify/database/migrations/ a partir da saida do drizzle-kit.
 *
 * A Netlify aplica as migrations sozinha no deploy, logo antes de publicar -
 * momento em que o banco ja foi provisionado. Rodar o migrator do Drizzle no
 * comando de build nao funciona: naquele ponto a conexao ainda nao existe.
 *
 * Para nao manter dois conjuntos de SQL escritos a mao, drizzle/ continua sendo
 * a unica fonte e esta pasta e sempre regenerada a partir dela.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DRIZZLE_DIR = "drizzle";
const TARGET_DIR = join("netlify", "database", "migrations");

const journalPath = join(DRIZZLE_DIR, "meta", "_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf8"));

rmSync(TARGET_DIR, { recursive: true, force: true });
mkdirSync(TARGET_DIR, { recursive: true });

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

for (const entry of journal.entries) {
  const sql = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), "utf8");
  const name = `${String(entry.idx).padStart(3, "0")}_${slugify(entry.tag)}`;
  const dir = join(TARGET_DIR, name);

  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "migration.sql"),
    `-- Gerado por scripts/sync-netlify-migrations.mjs a partir de ${DRIZZLE_DIR}/${entry.tag}.sql\n` +
      `-- Nao edite este arquivo: altere o schema e rode "npm run db:generate".\n\n${sql}`
  );

  console.log(`  ${name}`);
}

const written = readdirSync(TARGET_DIR).length;
console.log(`${written} migration(s) sincronizada(s) para ${TARGET_DIR}`);
