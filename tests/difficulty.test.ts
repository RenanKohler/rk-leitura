import { describe, expect, it } from "vitest";
import {
  parseBrakes,
  resolveSessionMode,
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
