import { describe, expect, it } from "vitest";
import { calendarLevel, calendarStart, textHistory, yearGrid } from "@/lib/calendar";

describe("calendario do ano (US-102)", () => {
  it("cinco niveis por minutos", () => {
    expect([0, 3, 10, 20, 45].map(calendarLevel)).toEqual([0, 1, 2, 3, 4]);
  });

  it("53 semanas de domingo a sabado terminando na semana de hoje", () => {
    const grid = yearGrid([], "2026-09-26");
    expect(grid).toHaveLength(53);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(new Date(`${grid[0]![0]!.day}T12:00:00Z`).getUTCDay()).toBe(0);
    const last = grid.at(-1)!;
    expect(last.some((cell) => cell.day === "2026-09-26")).toBe(true);
    expect(last.filter((cell) => cell.future)).toHaveLength(0); // 26/09/2026 e sabado
  });

  it("marca os minutos no dia certo", () => {
    const grid = yearGrid([{ day: "2026-09-20", minutes: 14 }], "2026-09-26");
    const cell = grid.flat().find((item) => item.day === "2026-09-20")!;
    expect(cell).toMatchObject({ minutes: 14, level: 2 });
  });

  it("dias depois de hoje ficam como futuros", () => {
    const grid = yearGrid([], "2026-09-23");
    expect(grid.at(-1)!.filter((cell) => cell.future).map((cell) => cell.day)).toEqual([
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
    ]);
    expect(calendarStart("2026-09-23")).toBe("2025-09-21");
  });
});

describe("textHistory (US-101)", () => {
  it("soma tempo, conta sessoes e pondera o ritmo", () => {
    const history = textHistory([
      { durationMs: 60_000, wordsRead: 300, wpm: 300, createdAt: new Date("2026-09-02T10:00:00Z") },
      { durationMs: 120_000, wordsRead: 100, wpm: 100, createdAt: new Date("2026-09-01T10:00:00Z") },
    ]);
    expect(history).toEqual({
      sessions: 2,
      totalMs: 180_000,
      wpm: 250,
      firstAt: "2026-09-01T10:00:00.000Z",
      lastAt: "2026-09-02T10:00:00.000Z",
    });
  });

  it("sem sessoes", () => {
    expect(textHistory([])).toMatchObject({ sessions: 0, firstAt: null });
  });
});
