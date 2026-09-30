import { describe, expect, it } from "vitest";
import {
  addBrake,
  addPage,
  addWords,
  createMeter,
  MAX_BRAKES,
  PAGE_MAX_MS,
  startClock,
  stopClock,
  takeRecord,
  wallMs,
} from "@/lib/reader-session";

describe("sessao do Word Runner", () => {
  it("desconta as pausas: o ritmo gravado e o das palavras", () => {
    const meter = createMeter();
    startClock(meter, "runner", 0);
    // 300 palavras a 300 ppm = 60 s de palavras + 12 s de pausas.
    addWords(meter, 300, 12_000);
    stopClock(meter, 72_000);
    const record = takeRecord(meter, 72_000)!;
    expect(record.durationMs).toBe(60_000);
    expect(record.wallMs).toBe(72_000);
    expect(record.mode).toBe("runner");
  });

  it("fechar a sessao com o relogio correndo nao congela o relogio", () => {
    const meter = createMeter();
    startClock(meter, "runner", 0);
    addWords(meter, 50);
    // Aba escondida: grava, mas a leitura segue contando.
    expect(takeRecord(meter, 10_000)?.durationMs).toBe(10_000);
    addWords(meter, 40);
    expect(wallMs(meter, 16_000)).toBe(6_000);
    stopClock(meter, 16_000);
    expect(takeRecord(meter, 16_000)?.wordsRead).toBe(40);
  });

  it("sessao curta nao e gravada", () => {
    const meter = createMeter();
    startClock(meter, "runner", 0);
    addWords(meter, 5);
    stopClock(meter, 3_000);
    expect(takeRecord(meter, 3_000)).toBeNull();
  });

  it("trocar para a narracao fecha a sessao do runner", () => {
    const meter = createMeter();
    startClock(meter, "runner", 0);
    addWords(meter, 60);
    const closed = startClock(meter, "narracao", 20_000);
    expect(closed).toMatchObject({ mode: "runner", wordsRead: 60, durationMs: 20_000 });
    addWords(meter, 30);
    stopClock(meter, 30_000);
    expect(takeRecord(meter, 30_000)).toMatchObject({ mode: "narracao", wordsRead: 30, durationMs: 10_000 });
  });

  it("guarda freios ate o limite", () => {
    const meter = createMeter();
    for (let i = 0; i < MAX_BRAKES + 10; i += 1) addBrake(meter, i);
    expect(meter.brakes).toHaveLength(MAX_BRAKES);
  });
});

describe("leitura na pagina", () => {
  it("conta a pagina com tempo plausivel, com teto", () => {
    const meter = createMeter();
    expect(addPage(meter, 200, 40_000, 40_000).counted).toBe(true);
    expect(addPage(meter, 200, 10 * 60_000, 700_000).counted).toBe(true);
    const record = takeRecord(meter, 700_000)!;
    expect(record).toMatchObject({ mode: "pagina", wordsRead: 400 });
    expect(record.durationMs).toBe(40_000 + PAGE_MAX_MS);
  });

  it("folhear rapido nao conta", () => {
    const meter = createMeter();
    expect(addPage(meter, 200, 2_000, 2_000).counted).toBe(false);
    expect(takeRecord(meter, 2_000)).toBeNull();
  });

  it("pagina depois do runner fecha a sessao do runner", () => {
    const meter = createMeter();
    startClock(meter, "runner", 0);
    addWords(meter, 80);
    stopClock(meter, 20_000);
    const { closed } = addPage(meter, 150, 30_000, 50_000);
    expect(closed).toMatchObject({ mode: "runner", wordsRead: 80 });
    expect(takeRecord(meter, 50_000)).toMatchObject({ mode: "pagina", wordsRead: 150 });
  });
});
