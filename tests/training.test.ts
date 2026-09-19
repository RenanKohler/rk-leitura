import { describe, expect, it } from "vitest";
import {
  asProgramLength,
  dailyStep,
  finalTarget,
  MIN_TRAINING_WORDS,
  programStatus,
  qualifies,
  targetFor,
  type TrainingDay,
} from "@/lib/training";
import { MAX_WPM } from "@/lib/reading";

const dia = (day: number, targetWpm: number, comprehension: number | null = null): TrainingDay => ({
  day,
  targetWpm,
  wpm: targetWpm,
  comprehension,
  onDay: `2026-09-${String(day).padStart(2, "0")}`,
});

describe("asProgramLength", () => {
  it("aceita apenas os dois programas oferecidos", () => {
    expect(asProgramLength(14)).toBe(14);
    expect(asProgramLength("30")).toBe(30);
    expect(asProgramLength(21)).toBeNull();
    expect(asProgramLength("muitos")).toBeNull();
  });
});

describe("targetFor", () => {
  it("o primeiro dia e a velocidade de partida", () => {
    expect(targetFor(300, 14, [])).toBe(300);
  });

  it("sobe um passo por dia cumprido", () => {
    const passo = dailyStep(300, 14);
    const alvo = targetFor(300, 14, [dia(1, 300)]);
    expect(alvo).toBe(Math.round((300 + passo) / 10) * 10);
  });

  it("nao sobe quando a compreensao ficou abaixo do piso", () => {
    expect(targetFor(300, 14, [dia(1, 300, 40)])).toBe(300);
  });

  it("sobe quando a compreensao ficou no piso ou acima", () => {
    expect(targetFor(300, 14, [dia(1, 300, 60)])).toBeGreaterThan(300);
  });

  it("sem questionario respondido, segue subindo", () => {
    expect(targetFor(300, 14, [dia(1, 300, null)])).toBeGreaterThan(300);
  });

  it("um dia ruim atrasa, nao zera o que ja foi conquistado", () => {
    const tresBons = [dia(1, 300, 80), dia(2, 310, 80), dia(3, 320, 80)];
    const comFalha = [...tresBons, dia(4, 340, 30)];
    expect(targetFor(300, 14, comFalha)).toBe(targetFor(300, 14, tresBons));
  });

  it("nao passa do teto do leitor", () => {
    const cinco = Array.from({ length: 5 }, (_, i) => dia(i + 1, 1_100, 80));
    expect(targetFor(1_100, 14, cinco)).toBe(MAX_WPM);
  });

  it("nao ultrapassa a meta final por mais dias cumpridos", () => {
    const todos = Array.from({ length: 20 }, (_, i) => dia(i + 1, 300, 90));
    expect(targetFor(300, 14, todos)).toBe(finalTarget(300, 14));
  });
});

describe("programa inteiro", () => {
  it("chega perto da meta prevista quando todos os dias sobem", () => {
    let days: TrainingDay[] = [];
    for (let day = 1; day <= 14; day += 1) {
      const alvo = targetFor(300, 14, days);
      days = [...days, dia(day, alvo, 80)];
    }
    expect(days.at(-1)!.targetWpm).toBe(finalTarget(300, 14));
    expect(days.at(-1)!.targetWpm).toBeGreaterThan(300);
  });

  it("um dia com compreensao baixa atrasa a meta em um passo", () => {
    let comFalha: TrainingDay[] = [];
    for (let day = 1; day <= 14; day += 1) {
      const alvo = targetFor(300, 14, comFalha);
      comFalha = [...comFalha, dia(day, alvo, day === 5 ? 40 : 80)];
    }
    expect(comFalha.at(-1)!.targetWpm).toBeLessThan(finalTarget(300, 14));
  });
});

describe("qualifies", () => {
  it("aceita a sessao no alvo", () => {
    expect(qualifies({ wpm: 400, wordsRead: 500 }, 400)).toBe(true);
  });

  it("aceita a folga de oscilacao logo abaixo do alvo", () => {
    expect(qualifies({ wpm: 385, wordsRead: 500 }, 400)).toBe(true);
  });

  it("recusa a sessao claramente abaixo do alvo", () => {
    expect(qualifies({ wpm: 300, wordsRead: 500 }, 400)).toBe(false);
  });

  it("recusa a leitura curta demais para ser treino", () => {
    expect(qualifies({ wpm: 400, wordsRead: MIN_TRAINING_WORDS - 1 }, 400)).toBe(false);
  });
});

describe("programStatus", () => {
  const programa = { length: 14 as const, startWpm: 300, previousWpm: 250, startedOn: "2026-09-01" };

  it("comeca no dia 1", () => {
    const status = programStatus(programa, [], "2026-09-01");
    expect(status.currentDay).toBe(1);
    expect(status.targetWpm).toBe(300);
    expect(status.doneToday).toBe(false);
    expect(status.finished).toBe(false);
  });

  it("avanca conforme os dias sao cumpridos", () => {
    const status = programStatus(programa, [dia(1, 300, 80), dia(2, 310, 80)], "2026-09-03");
    expect(status.currentDay).toBe(3);
    expect(status.doneToday).toBe(false);
  });

  it("reconhece o dia ja cumprido hoje", () => {
    const status = programStatus(programa, [dia(1, 300)], "2026-09-01");
    expect(status.doneToday).toBe(true);
  });

  it("termina no ultimo dia e para de subir o alvo", () => {
    const days = Array.from({ length: 14 }, (_, i) => dia(i + 1, 300 + i * 10, 80));
    const status = programStatus(programa, days, "2026-09-20");
    expect(status.finished).toBe(true);
    expect(status.currentDay).toBe(15);
    expect(status.targetWpm).toBe(days.at(-1)!.targetWpm);
  });

  it("ordena os dias mesmo se vierem fora de ordem", () => {
    const status = programStatus(programa, [dia(2, 310), dia(1, 300)], "2026-09-03");
    expect(status.days.map((d) => d.day)).toEqual([1, 2]);
  });
});

describe("os dois programas", () => {
  it("nao prometem a mesma meta", () => {
    expect(finalTarget(300, 14)).not.toBe(finalTarget(300, 30));
  });

  it("o programa mais longo chega mais alto", () => {
    expect(finalTarget(300, 30)).toBeGreaterThan(finalTarget(300, 14));
  });

  it("o programa mais curto sobe mais por dia", () => {
    expect(dailyStep(300, 14)).toBeGreaterThan(dailyStep(300, 30));
  });
});
