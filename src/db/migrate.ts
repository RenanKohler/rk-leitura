import "../lib/load-env";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, getPool } from "./index";

async function main() {
  console.log("Aplicando migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations aplicadas.");
  await getPool().end();
}

main().catch((error) => {
  console.error("Falha ao aplicar migrations:", error);
  process.exit(1);
});
