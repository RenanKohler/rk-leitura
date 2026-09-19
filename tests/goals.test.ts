import { describe, expect, it } from "vitest";
import {
  asGoalKind,
  asTimezone,
  computeStreak,
  goalMet,
  goalOn,
  GOAL_LIMITS,
  mondayOf,
  previousDay,
  progressFor,
  todayIn,
  type DayTotals,
  type Goal,
} from "@/lib/goals";

const meta = (target: number, startsOn: string, kind: Goal["kind"] = "minutos"): Goal => ({
  kind,
  target,
  startsOn,
});

const dia = (day: string, minutes: number, words = minutes * 300): DayTotals => ({
  day,
  minutes,
  words,
});

describe("asTimezone", () => {
  it("aceita fuso IANA conhecido", () => {
    expect(asTimezone("America/Sao_Paulo")).toBe("America/Sao_Paulo");
    expect(asTimezone("UTC")).toBe("UTC");
  });

  it("cai para UTC no que nao existe", () => {
    // A propria Intl e a lista: manter uma copia aqui recusaria fusos novos.
    expect(asTimezone("Marte/Olympus")).toBe("UTC");
    expect(asTimezone("")).toBe("UTC");
    expect(asTimezone(null)).toBe("UTC");
    expect(asTimezone(42)).toBe("UTC");
  });
});

describe("todayIn", () => {
  it("le o dia no fuso, nao em UTC", () => {
    // 2026-03-10 02:00 UTC ainda e dia 9 em Sao Paulo (UTC-3).
    const instante = new Date("2026-03-10T02:00:00Z");
    expect(todayIn("UTC", instante)).toBe("2026-03-10");
    expect(todayIn("America/Sao_Paulo", instante)).toBe("2026-03-09");
  });

  it("e o caso que justifica guardar o fuso", () => {
    // Uma leitura das 22h em Sao Paulo cai no dia seguinte em UTC. Sem o
    // fuso, a meta do dia e a sequencia contariam no dia errado.
    const noite = new Date("2026-03-09T01:30:00Z"); // 22h30 do dia 8 em SP
    expect(todayIn("America/Sao_Paulo", noite)).toBe("2026-03-08");
    expect(todayIn("UTC", noite)).toBe("2026-03-09");
  });
});

describe("previousDay e mondayOf", () => {
  it("volta um dia, inclusive virando mes e ano", () => {
    expect(previousDay("2026-03-10")).toBe("2026-03-09");
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
  });

  it("acha a segunda da semana", () => {
    expect(mondayOf("2026-03-11")).toBe("2026-03-09"); // quarta -> segunda
    expect(mondayOf("2026-03-09")).toBe("2026-03-09"); // segunda -> ela mesma
    expect(mondayOf("2026-03-15")).toBe("2026-03-09"); // domingo -> segunda anterior
  });
});

describe("goalOn", () => {
  const metas = [meta(10, "2026-01-01"), meta(30, "2026-03-01"), meta(60, "2026-06-01")];

  it("usa a meta vigente no dia, nao a de hoje", () => {
    // O criterio 4 da US-42: mudar a meta nao pode reescrever o passado.
    expect(goalOn(metas, "2026-02-15")?.target).toBe(10);
    expect(goalOn(metas, "2026-03-01")?.target).toBe(30);
    expect(goalOn(metas, "2026-12-31")?.target).toBe(60);
  });

  it("devolve null antes da primeira meta", () => {
    expect(goalOn(metas, "2025-12-31")).toBeNull();
    expect(goalOn([], "2026-03-01")).toBeNull();
  });
});

describe("progressFor e goalMet", () => {
  it("conta minutos ou palavras conforme o tipo", () => {
    const totais = dia("2026-03-10", 20, 4000);
    expect(progressFor(meta(10, "2026-01-01", "minutos"), totais)).toBe(20);
    expect(progressFor(meta(10, "2026-01-01", "palavras"), totais)).toBe(4000);
  });

  it("dia sem leitura conta zero, nao indefinido", () => {
    expect(progressFor(meta(10, "2026-01-01"), undefined)).toBe(0);
    expect(goalMet(meta(10, "2026-01-01"), undefined)).toBe(false);
  });

  it("atingir exatamente a meta cumpre", () => {
    expect(goalMet(meta(10, "2026-01-01"), dia("2026-03-10", 10))).toBe(true);
    expect(goalMet(meta(10, "2026-01-01"), dia("2026-03-10", 9))).toBe(false);
  });
});

describe("computeStreak", () => {
  const metas = [meta(10, "2026-01-01")];

  it("conta dias seguidos ate hoje", () => {
    const dias = [dia("2026-03-08", 15), dia("2026-03-09", 15), dia("2026-03-10", 15)];
    expect(computeStreak(dias, metas, "2026-03-10")).toMatchObject({
      current: 3,
      pendingToday: false,
    });
  });

  it("mantem a sequencia viva quando hoje ainda nao foi cumprido", () => {
    const dias = [dia("2026-03-08", 15), dia("2026-03-09", 15)];
    expect(computeStreak(dias, metas, "2026-03-10")).toMatchObject({
      current: 2,
      pendingToday: true,
    });
  });

  it("zera quando um dia inteiro passou em branco", () => {
    const dias = [dia("2026-03-05", 15), dia("2026-03-06", 15)];
    const resultado = computeStreak(dias, metas, "2026-03-10");
    expect(resultado.current).toBe(0);
    expect(resultado.best).toBe(2);
  });

  it("preserva a maior sequencia depois de quebrar", () => {
    const dias = [
      dia("2026-03-01", 15),
      dia("2026-03-02", 15),
      dia("2026-03-03", 15),
      dia("2026-03-04", 15),
      // 05 e 06 em branco
      dia("2026-03-09", 15),
      dia("2026-03-10", 15),
    ];
    expect(computeStreak(dias, metas, "2026-03-10")).toMatchObject({ current: 2, best: 4 });
  });

  it("avalia cada dia pela meta que valia nele", () => {
    const historico = [meta(10, "2026-01-01"), meta(60, "2026-03-10")];
    const dias = [dia("2026-03-08", 15), dia("2026-03-09", 15), dia("2026-03-10", 15)];
    // 15 minutos cumpriam a meta de 10, mas nao a de 60 que passou a valer hoje.
    expect(computeStreak(dias, historico, "2026-03-10")).toMatchObject({
      current: 2,
      pendingToday: true,
    });
  });

  it("sem meta definida nao ha sequencia", () => {
    expect(computeStreak([dia("2026-03-10", 99)], [], "2026-03-10")).toMatchObject({
      current: 0,
      best: 0,
    });
  });
});

describe("limites da meta", () => {
  it("cobrem as faixas dos criterios", () => {
    expect(GOAL_LIMITS.minutos).toEqual({ min: 5, max: 180 });
    expect(GOAL_LIMITS.palavras).toEqual({ min: 500, max: 50_000 });
  });

  it("tipo desconhecido cai em minutos", () => {
    expect(asGoalKind("paginas")).toBe("minutos");
    expect(asGoalKind("palavras")).toBe("palavras");
  });
});
