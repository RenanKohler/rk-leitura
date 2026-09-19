import { describe, expect, it } from "vitest";
import { asReminderHour, hourIn, reminderBody, shouldRemind } from "@/lib/reminder";

const base = {
  reminderHour: 19,
  timezone: "America/Sao_Paulo",
  reminderSentOn: null,
  metGoal: false,
  readToday: false,
};

/** 2026-09-19 23:30 UTC = 20:30 em Sao Paulo. */
const noiteSP = new Date("2026-09-19T23:30:00Z");
/** 2026-09-19 15:00 UTC = 12:00 em Sao Paulo. */
const meioDiaSP = new Date("2026-09-19T15:00:00Z");

describe("asReminderHour", () => {
  it("aceita as horas do dia", () => {
    expect(asReminderHour(0)).toBe(0);
    expect(asReminderHour("19")).toBe(19);
    expect(asReminderHour(23)).toBe(23);
  });

  it("recusa o que nao e hora", () => {
    expect(asReminderHour(24)).toBeNull();
    expect(asReminderHour(-1)).toBeNull();
    expect(asReminderHour("tarde")).toBeNull();
  });

  it("ausente significa sem lembrete", () => {
    expect(asReminderHour(null)).toBeNull();
    expect(asReminderHour(undefined)).toBeNull();
    expect(asReminderHour("")).toBeNull();
  });
});

describe("hourIn", () => {
  it("le a hora no fuso do leitor", () => {
    expect(hourIn("America/Sao_Paulo", noiteSP)).toBe(20);
    expect(hourIn("UTC", noiteSP)).toBe(23);
  });

  it("fuso invalido cai em UTC em vez de quebrar", () => {
    expect(hourIn("Nao/Existe", noiteSP)).toBe(23);
  });
});

describe("shouldRemind", () => {
  it("manda depois da hora escolhida", () => {
    expect(shouldRemind(base, "2026-09-19", noiteSP)).toBe(true);
  });

  it("nao manda antes da hora", () => {
    expect(shouldRemind(base, "2026-09-19", meioDiaSP)).toBe(false);
  });

  it("nao manda para quem nao quer lembrete", () => {
    expect(shouldRemind({ ...base, reminderHour: null }, "2026-09-19", noiteSP)).toBe(false);
  });

  it("nao manda para quem ja cumpriu a meta", () => {
    expect(shouldRemind({ ...base, metGoal: true }, "2026-09-19", noiteSP)).toBe(false);
  });

  it("nao manda para quem ja leu hoje", () => {
    expect(shouldRemind({ ...base, readToday: true }, "2026-09-19", noiteSP)).toBe(false);
  });

  it("nao manda duas vezes no mesmo dia", () => {
    expect(
      shouldRemind({ ...base, reminderSentOn: "2026-09-19" }, "2026-09-19", noiteSP)
    ).toBe(false);
  });

  it("volta a mandar no dia seguinte", () => {
    expect(
      shouldRemind({ ...base, reminderSentOn: "2026-09-18" }, "2026-09-19", noiteSP)
    ).toBe(true);
  });

  it("um disparo tardio ainda alcanca quem escolheu cedo", () => {
    // Agendador que roda uma vez por dia, a noite: quem pediu 8h recebe.
    expect(shouldRemind({ ...base, reminderHour: 8 }, "2026-09-19", noiteSP)).toBe(true);
  });
});

describe("reminderBody", () => {
  it("menciona a sequencia quando ela existe", () => {
    expect(reminderBody(5)).toContain("5 dias");
  });

  it("sem sequencia, so convida", () => {
    expect(reminderBody(0)).not.toMatch(/\d+ dias/);
    expect(reminderBody(1)).not.toMatch(/\d+ dias/);
  });
});
