import { describe, expect, it } from "vitest";
import { firstHighlightDue } from "@/lib/highlights";

/** Primeira revisao do destaque pelo dia do leitor (US-199). */
describe("primeira revisao do destaque", () => {
  it("criado as 22h em Sao Paulo vence na manha seguinte", () => {
    // 22h de 23/10 em Sao Paulo = 01h de 24/10 em UTC.
    const created = new Date("2026-10-24T01:00:00Z");
    expect(firstHighlightDue(created, "America/Sao_Paulo")).toBe("2026-10-24");
  });

  it("usa o dia do fuso, nao o de UTC", () => {
    const created = new Date("2026-10-24T01:00:00Z");
    expect(firstHighlightDue(created, "UTC")).toBe("2026-10-25");
  });
});
