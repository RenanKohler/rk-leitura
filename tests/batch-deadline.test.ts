import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeQuery } from "./helpers/fake-query";

/**
 * Lote de definicoes (US-207): o acompanhamento para no prazo, e um envio que
 * falha devolve as unidades de cota reservadas.
 */

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  retrieve: vi.fn(),
  create: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: mocks.select,
    transaction: mocks.transaction,
    delete: mocks.remove,
    update: mocks.update,
  },
}));

vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  aiClient: () => ({
    messages: { batches: { retrieve: mocks.retrieve, create: mocks.create } },
  }),
  recordUsage: vi.fn(),
}));

vi.mock("@/lib/daily-quota", () => ({
  reserveDailyQuota: mocks.reserve,
  releaseDailyQuota: mocks.release,
}));

import { settleDefinitionBatches, startDefinitionBatch } from "@/lib/word-batch";
import { AiUnavailable } from "@/lib/ai";

const row = (id: string) => ({
  id,
  userId: "u1",
  batchId: `msgbatch_${id}`,
  status: "processando",
  wordIds: [],
  createdAt: new Date(),
  endedAt: null,
});

let clock = 1_000;

beforeEach(() => {
  vi.resetAllMocks();
  clock = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("conferencia dos lotes no acompanhamento", () => {
  it("nao confere nada com o prazo vencido", async () => {
    mocks.select.mockReturnValue(fakeQuery([row("a"), row("b")]));
    const report = await settleDefinitionBatches(clock - 1);
    expect(report).toEqual({ checked: 0, ended: 0 });
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("para no lote em que o prazo venceu e deixa o resto para a proxima", async () => {
    mocks.select.mockReturnValue(fakeQuery([row("a"), row("b"), row("c")]));
    // Cada conferencia leva 30 s; o prazo cabe so a primeira.
    mocks.retrieve.mockImplementation(async () => {
      clock += 30_000;
      return { processing_status: "in_progress" };
    });
    const report = await settleDefinitionBatches(clock + 20_000);
    expect(report).toEqual({ checked: 1, ended: 0 });
    expect(mocks.retrieve).toHaveBeenCalledTimes(1);
  });
});

describe("envio do lote", () => {
  it("devolve as unidades reservadas quando o envio falha", async () => {
    const words = ["w1", "w2", "w3"].map((id) => ({ id, word: id, context: "", language: "pt" }));
    mocks.select.mockReturnValue(fakeQuery(words));
    mocks.transaction.mockImplementation(async (work: (tx: unknown) => unknown) =>
      work({
        execute: async () => undefined,
        select: () => fakeQuery([]),
        insert: () => fakeQuery([{ id: "linha" }]),
      })
    );
    // Cabem 2 das 3 palavras na cota de hoje.
    mocks.reserve.mockResolvedValue(2);
    mocks.create.mockRejectedValue(new Error("rede caiu"));
    mocks.remove.mockReturnValue(fakeQuery(undefined));
    mocks.release.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(startDefinitionBatch("u1")).rejects.toBeInstanceOf(AiUnavailable);
    expect(mocks.reserve).toHaveBeenCalledWith("dicionario", "u1", 3);
    expect(mocks.release).toHaveBeenCalledWith("dicionario", "u1", 2);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it("sem cota, nada e enviado nem devolvido", async () => {
    mocks.select.mockReturnValue(fakeQuery([{ id: "w1", word: "w1", context: "", language: "pt" }]));
    mocks.transaction.mockImplementation(async (work: (tx: unknown) => unknown) =>
      work({ execute: async () => undefined, select: () => fakeQuery([]) })
    );
    mocks.reserve.mockResolvedValue(0);

    await expect(startDefinitionBatch("u1")).resolves.toEqual({ status: "quota", pending: 1 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });
});
