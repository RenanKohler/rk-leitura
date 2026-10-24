import { describe, expect, it } from "vitest";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import { ACCOUNT_EXPORT_TABLES, NOT_IN_ACCOUNT_EXPORT } from "@/lib/export-coverage";

const tables = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableName(table as PgTable));

describe("exportacao da conta completa (US-189)", () => {
  it("toda tabela do schema esta na exportacao ou tem motivo para ficar fora", () => {
    const covered = new Set<string>([...ACCOUNT_EXPORT_TABLES, ...Object.keys(NOT_IN_ACCOUNT_EXPORT)]);
    const missing = tables.filter((name) => !covered.has(name));
    expect(missing, `tabelas sem entrada na exportacao: ${missing.join(", ")}`).toEqual([]);
  });

  it("as listas so citam tabelas que existem", () => {
    const known = new Set(tables);
    const stale = [...ACCOUNT_EXPORT_TABLES, ...Object.keys(NOT_IN_ACCOUNT_EXPORT)].filter(
      (name) => !known.has(name)
    );
    expect(stale).toEqual([]);
  });

  it("nenhuma tabela esta nas duas listas", () => {
    const both = ACCOUNT_EXPORT_TABLES.filter((name) => name in NOT_IN_ACCOUNT_EXPORT);
    expect(both).toEqual([]);
  });

  it("as tabelas citadas na Evidencia da story saem", () => {
    for (const name of [
      "ask_turns",
      "ai_results",
      "reading_goals",
      "speed_settings",
      "feeds",
      "series_follows",
      "training_programs",
      "review_answers",
      "quiz_recalls",
    ]) {
      expect(ACCOUNT_EXPORT_TABLES).toContain(name);
    }
  });
});
