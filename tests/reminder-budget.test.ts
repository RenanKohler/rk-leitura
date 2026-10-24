import { describe, expect, it } from "vitest";
import { REMINDER_BUDGET_MS, reminderOrder } from "@/lib/reminder";
import { PUSH_TIMEOUT_MS } from "@/lib/push";

describe("prazo do cron de lembretes (US-203)", () => {
  it("prazos abaixo do teto da funcao", () => {
    expect(PUSH_TIMEOUT_MS).toBe(10_000);
    expect(REMINDER_BUDGET_MS).toBe(50_000);
  });

  it("quem ainda pode receber vem antes de quem ja recebeu os dois", () => {
    const today = "2026-10-24";
    const done = { id: "a", reminderSentOn: today, reviewReminderSentOn: today, today };
    const pending = { id: "b", reminderSentOn: "2026-10-23", reviewReminderSentOn: today, today };
    const fresh = { id: "c", reminderSentOn: null, reviewReminderSentOn: null, today };
    expect(reminderOrder([done, pending, fresh]).map((c) => c.id)).toEqual(["b", "c", "a"]);
  });
});
