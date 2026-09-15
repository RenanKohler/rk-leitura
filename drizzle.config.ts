import "./src/lib/load-env";
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL nao definida. Copie .env.example para .env.local e preencha a connection string."
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
