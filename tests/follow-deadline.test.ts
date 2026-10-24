import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeQuery } from "./helpers/fake-query";

/**
 * Verificacao de series e feeds (US-207): a rotina para quando o prazo da
 * funcao vence, e o que ficou para tras abre a proxima execucao.
 */

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  importNext: vi.fn(),
  fetchFeed: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { select: mocks.select, update: mocks.update } }));
vi.mock("@/lib/chapter-import", () => ({ importNextChapter: mocks.importNext }));
vi.mock("@/lib/safe-fetch", () => ({ fetchPublicFeed: mocks.fetchFeed }));
vi.mock("@/lib/notify", () => ({ notifyUser: vi.fn() }));
vi.mock("@/lib/queries", () => ({ findTextBySourceUrl: vi.fn() }));

import { runFollowUps } from "@/lib/follow-runner";

const source = (id: string) => ({
  id,
  userId: "u1",
  seriesKey: `serie-${id}`,
  url: `https://exemplo.com/${id}.xml`,
  title: id,
  failures: 0,
  lastCheckedAt: null,
  pausedAt: null,
  seenUntil: null,
});

let clock = 1_000;
const now = new Date("2026-10-24T12:00:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  clock = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  mocks.update.mockReturnValue(fakeQuery(undefined));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("prazo da verificacao", () => {
  it("com o prazo vencido nao verifica nenhuma fonte", async () => {
    mocks.select.mockReturnValueOnce(fakeQuery([source("a")]));
    const report = await runFollowUps(now, clock - 1);
    expect(report).toEqual({ series: 0, feeds: 0, imported: 0, paused: 0 });
    expect(mocks.importNext).not.toHaveBeenCalled();
  });

  it("para na serie em que o prazo venceu e nem chega aos feeds", async () => {
    mocks.select
      .mockReturnValueOnce(fakeQuery([source("a"), source("b")]))
      .mockReturnValueOnce(fakeQuery([{ id: "ultimo" }]));
    mocks.importNext.mockImplementation(async () => {
      clock += 30_000;
      return { status: "none" };
    });

    const report = await runFollowUps(now, clock + 20_000);
    expect(report.series).toBe(1);
    expect(mocks.importNext).toHaveBeenCalledTimes(1);
    // A primeira consulta e a das series, a segunda a do ultimo capitulo: a
    // dos feeds nunca acontece.
    expect(mocks.select).toHaveBeenCalledTimes(2);
  });

  it("para no feed em que o prazo venceu", async () => {
    mocks.select
      .mockReturnValueOnce(fakeQuery([]))
      .mockReturnValueOnce(fakeQuery([source("a"), source("b"), source("c")]));
    mocks.fetchFeed.mockImplementation(async () => {
      clock += 30_000;
      throw new Error("fora do ar");
    });

    const report = await runFollowUps(now, clock + 20_000);
    expect(report.feeds).toBe(1);
    expect(mocks.fetchFeed).toHaveBeenCalledTimes(1);
  });
});
