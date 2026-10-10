import { describe, expect, it } from "vitest";
import { reviewReminderBody, shouldRemindReview } from "@/lib/reminder";

const base = {
  reviewReminder: true,
  reminderHour: 19,
  timezone: "America/Sao_Paulo",
  reviewReminderSentOn: null,
  due: 8,
  reviewedToday: false,
};

/** 2026-10-10 23:30 UTC = 20:30 em Sao Paulo. */
const noite = new Date("2026-10-10T23:30:00Z");
/** 2026-10-10 15:00 UTC = 12:00 em Sao Paulo. */
const meioDia = new Date("2026-10-10T15:00:00Z");
const today = "2026-10-10";

describe("lembrete de revisao", () => {
  it("sai depois da hora, com 5 ou mais itens e sem revisao hoje", () => {
    expect(shouldRemindReview(base, today, noite)).toBe(true);
    expect(shouldRemindReview({ ...base, due: 5 }, today, noite)).toBe(true);
  });

  it("antes da hora, nada", () => {
    expect(shouldRemindReview(base, today, meioDia)).toBe(false);
  });

  it("com menos de 5 itens, nada", () => {
    expect(shouldRemindReview({ ...base, due: 4 }, today, noite)).toBe(false);
  });

  it("revisao ja feita hoje, nada", () => {
    expect(shouldRemindReview({ ...base, reviewedToday: true }, today, noite)).toBe(false);
  });

  it("uma vez por dia", () => {
    expect(shouldRemindReview({ ...base, reviewReminderSentOn: today }, today, noite)).toBe(false);
    expect(shouldRemindReview({ ...base, reviewReminderSentOn: "2026-10-09" }, today, noite)).toBe(true);
  });

  it("desligado, ou sem hora do lembrete diario, nada", () => {
    expect(shouldRemindReview({ ...base, reviewReminder: false }, today, noite)).toBe(false);
    expect(shouldRemindReview({ ...base, reminderHour: null }, today, noite)).toBe(false);
  });

  it("texto da notificacao", () => {
    expect(reviewReminderBody(12)).toBe("12 itens para revisar hoje.");
  });
});
