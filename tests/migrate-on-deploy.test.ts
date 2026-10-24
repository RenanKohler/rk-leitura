import { describe, expect, it } from "vitest";
import { shouldMigrate } from "../scripts/migrate-on-deploy.mjs";

describe("migrations so em producao (US-204)", () => {
  it("Production migra", () => {
    expect(shouldMigrate({ VERCEL_ENV: "production" })).toBe(true);
  });

  it("Preview e Development nao migram", () => {
    expect(shouldMigrate({ VERCEL_ENV: "preview" })).toBe(false);
    expect(shouldMigrate({ VERCEL_ENV: "development" })).toBe(false);
  });

  it("fora da Vercel migra, como antes", () => {
    expect(shouldMigrate({})).toBe(true);
  });
});
