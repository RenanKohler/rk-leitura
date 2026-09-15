-- Gerado por scripts/sync-netlify-migrations.mjs a partir de drizzle/0001_fat_la_nuit.sql
-- Nao edite este arquivo: altere o schema e rode "npm run db:generate".

ALTER TABLE "texts" ADD COLUMN "source_page" integer DEFAULT 1 NOT NULL;