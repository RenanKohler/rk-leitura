import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const executed: unknown[] = [];
vi.mock("@/db", () => ({
  db: { execute: vi.fn(async (query: unknown) => executed.push(query)) },
}));
const release = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/daily-quota", () => ({ releaseDailyQuota: (...args: unknown[]) => release(...args) }));

const { AiUnavailable, translate } = await import("@/lib/ai");
const { refundsQuota, settleFailedCall } = await import("@/lib/ai-refund");
const { QUIZ_TIMEOUT_MESSAGE } = await import("@/lib/quiz-generator");

const call = { userId: "u1", task: "glossario" as const, quota: "estudo" as const };

describe("devolver a cota quando a resposta nao serve (US-195)", () => {
  beforeEach(() => {
    executed.length = 0;
    release.mockClear();
  });

  it("falha da API e tempo esgotado devolvem a cota sem marcar o registro", async () => {
    await settleFailedCall(new AiUnavailable("Falhou."), call);
    expect(release).toHaveBeenCalledWith("estudo", "u1", 1);
    expect(executed).toHaveLength(0);
  });

  it("resposta invalida devolve a cota e marca o registro como invalida", async () => {
    await settleFailedCall(AiUnavailable.invalid("Nada serviu."), { ...call, units: 2 });
    expect(release).toHaveBeenCalledWith("estudo", "u1", 2);
    expect(executed).toHaveLength(1);
  });

  it("recusa do modelo e erro do app nao devolvem", async () => {
    await settleFailedCall(new AiUnavailable("Recusou.", 503, true), call);
    await settleFailedCall(new Error("bug"), call);
    expect(release).not.toHaveBeenCalled();
    expect(refundsQuota(new AiUnavailable("Recusou.", 503, true))).toBe(false);
    expect(refundsQuota(AiUnavailable.invalid("x"))).toBe(true);
  });
});

describe("prazo do questionario (US-196)", () => {
  const messages = { notConfigured: "n", refusal: "r", failure: "Falhou.", timeout: QUIZ_TIMEOUT_MESSAGE };

  it("tempo esgotado vira a mensagem propria", () => {
    const error = new Anthropic.APIConnectionTimeoutError();
    expect(translate(error, messages, "questionario").message).toBe(
      "O questionário demorou demais. Tente de novo."
    );
  });

  it("sem mensagem de prazo, vale a de falha", () => {
    const { timeout: _timeout, ...plain } = messages;
    void _timeout;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(translate(new Anthropic.APIConnectionTimeoutError(), plain, "questionario").message).toBe("Falhou.");
  });
});
