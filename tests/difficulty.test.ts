import { describe, expect, it } from "vitest";
import {
  parseBrakes,
  resolveSessionMode,
  SLOWDOWN_QUIET_DAYS,
  slowdownSamples,
  suggestSlowdown,
  type BrakeSample,
} from "@/lib/difficulty";

const runner = (wordsRead: number, brakes: number | null): BrakeSample => ({
  mode: "runner",
  wordsRead,
  brakes: brakes === null ? null : Array.from({ length: brakes }, (_, i) => i * 10),
});

describe("modo da sessao", () => {
  it("padrao e runner", () => {
    expect(resolveSessionMode(undefined, undefined)).toBe("runner");
    expect(resolveSessionMode("pagina", false)).toBe("pagina");
  });

  it("narrated=true implica narracao", () => {
    expect(resolveSessionMode(undefined, true)).toBe("narracao");
    expect(resolveSessionMode("runner", true)).toBe("narracao");
  });

  it("modo desconhecido e recusado", () => {
    expect(resolveSessionMode("rsvp", false)).toBeNull();
    expect(resolveSessionMode(3, undefined)).toBeNull();
  });
});

describe("freios", () => {
  it("ausente vira null, lista valida passa", () => {
    expect(parseBrakes(undefined)).toBeNull();
    expect(parseBrakes([0, 15, 300])).toEqual([0, 15, 300]);
  });

  it("recusa mais de 200, fracao, negativo e texto", () => {
    expect(parseBrakes(Array.from({ length: 201 }, () => 1))).toBeUndefined();
    expect(parseBrakes([1.5])).toBeUndefined();
    expect(parseBrakes([-1])).toBeUndefined();
    expect(parseBrakes(["3"])).toBeUndefined();
    expect(parseBrakes("3")).toBeUndefined();
  });
});

describe("sugestao de desacelerar", () => {
  it("sugere -25 ppm com mais de 1 freio a cada 150 palavras nas ultimas 3", () => {
    // 900 palavras, 7 freios: 1,17 por 150.
    const suggestion = suggestSlowdown([runner(300, 3), runner(300, 2), runner(300, 2)]);
    expect(suggestion?.deltaWpm).toBe(-25);
    expect(suggestion?.sessions).toBe(3);
    expect(suggestion?.brakesPer150).toBe(1.2);
  });

  it("exatamente 1 por 150 palavras nao basta", () => {
    expect(suggestSlowdown([runner(300, 2), runner(300, 2), runner(300, 2)])).toBeNull();
  });

  it("precisa de 3 sessoes do runner que mediram freios", () => {
    expect(suggestSlowdown([runner(300, 9), runner(300, 9)])).toBeNull();
    expect(suggestSlowdown([runner(300, 9), runner(300, 9), runner(300, null)])).toBeNull();
  });

  it("ignora narracao e pagina e olha so as 3 mais recentes", () => {
    const sessions: BrakeSample[] = [
      { mode: "narracao", wordsRead: 300, brakes: [1, 2, 3, 4, 5, 6] },
      runner(300, 0),
      { mode: "pagina", wordsRead: 300, brakes: [1, 2, 3, 4, 5, 6] },
      runner(300, 0),
      runner(300, 0),
      runner(300, 50),
    ];
    expect(suggestSlowdown(sessions)).toBeNull();
  });
});

describe("slowdownSamples (US-218)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const answeredAt = new Date("2026-03-10T12:00:00Z");
  const at = (offsetMs: number) => ({
    ...runner(300, 9),
    createdAt: new Date(answeredAt.getTime() + offsetMs),
  });
  const before = [at(-3 * DAY), at(-2 * DAY), at(-DAY)];
  const after = [at(DAY), at(2 * DAY), at(3 * DAY)];

  it("sem resposta anterior, todas as sessoes contam", () => {
    const now = new Date(answeredAt.getTime() + DAY);
    expect(slowdownSamples(before, null, now)).toEqual(before);
    expect(suggestSlowdown(slowdownSamples(before, null, now))).not.toBeNull();
  });

  it("durante os dias de silencio nada conta, nem sessao nova", () => {
    const lastQuiet = new Date(answeredAt.getTime() + SLOWDOWN_QUIET_DAYS * DAY - 1);
    expect(slowdownSamples([...after, ...before], answeredAt, lastQuiet)).toEqual([]);
    expect(suggestSlowdown(slowdownSamples(after, answeredAt, lastQuiet))).toBeNull();
  });

  it("passado o silencio, so as sessoes depois da resposta contam", () => {
    const later = new Date(answeredAt.getTime() + SLOWDOWN_QUIET_DAYS * DAY);
    expect(slowdownSamples([...after, ...before], answeredAt, later)).toEqual(after);
    // As sessoes que geraram a sugestao respondida nao a trazem de volta.
    expect(suggestSlowdown(slowdownSamples(before, answeredAt, later))).toBeNull();
    expect(suggestSlowdown(slowdownSamples([...after, ...before], answeredAt, later))).not.toBeNull();
  });

  it("sessao gravada no instante da resposta fica de fora", () => {
    const later = new Date(answeredAt.getTime() + SLOWDOWN_QUIET_DAYS * DAY);
    expect(slowdownSamples([at(0)], answeredAt, later)).toEqual([]);
  });
});
