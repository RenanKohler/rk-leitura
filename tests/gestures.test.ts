import { describe, expect, it } from "vitest";
import {
  classifyGesture,
  EDGE_GUARD_PX,
  LONG_PRESS_MS,
  MOVE_TOLERANCE_PX,
  movedPastTolerance,
  SWIPE_MAX_MS,
  SWIPE_MIN_PX,
  type GestureSample,
} from "@/lib/gestures";

const WIDTH = 360;

/** Gesto que comeca no meio da tela; cada teste muda so o que interessa. */
function sample(overrides: Partial<GestureSample> = {}): GestureSample {
  return {
    startX: 180,
    startY: 400,
    endX: 180,
    endY: 400,
    durationMs: 120,
    stillMs: null,
    viewportWidth: WIDTH,
    ...overrides,
  };
}

/** Deslize horizontal de `deltaX` px a partir de `startX`, sem ficar parado. */
function swipe(deltaX: number, overrides: Partial<GestureSample> = {}): GestureSample {
  const startX = overrides.startX ?? 180;
  return sample({ startX, endX: startX + deltaX, stillMs: 20, durationMs: 200, ...overrides });
}

describe("classifyGesture (US-210)", () => {
  describe("toque", () => {
    it("ponteiro parado e solto rapido e toque", () => {
      expect(classifyGesture(sample())).toBe("toque");
    });

    it("no limite do toque longo deixa de ser toque: e do dicionario", () => {
      expect(classifyGesture(sample({ durationMs: LONG_PRESS_MS - 1 }))).toBe("toque");
      expect(classifyGesture(sample({ durationMs: LONG_PRESS_MS }))).toBeNull();
    });

    it("toque na faixa da borda continua toque: so o deslize e do sistema", () => {
      expect(classifyGesture(sample({ startX: 4, endX: 4 }))).toBe("toque");
      expect(classifyGesture(sample({ startX: WIDTH - 4, endX: WIDTH - 4 }))).toBe("toque");
    });
  });

  describe("distancia", () => {
    it("deslize para a esquerda e para a direita a partir do minimo", () => {
      expect(classifyGesture(swipe(-SWIPE_MIN_PX))).toBe("deslize-esquerda");
      expect(classifyGesture(swipe(SWIPE_MIN_PX))).toBe("deslize-direita");
    });

    it("arraste mais curto que o minimo nao e gesto nenhum", () => {
      expect(classifyGesture(swipe(-(SWIPE_MIN_PX - 1)))).toBeNull();
      expect(classifyGesture(swipe(SWIPE_MIN_PX - 1))).toBeNull();
    });

    it("deslocamento vertical igual ou maior que o horizontal nao e deslize", () => {
      expect(classifyGesture(swipe(-80, { endY: 400 + 79 }))).toBe("deslize-esquerda");
      expect(classifyGesture(swipe(-80, { endY: 400 + 80 }))).toBeNull();
      expect(classifyGesture(swipe(80, { endY: 400 - 200 }))).toBeNull();
    });
  });

  describe("tempo", () => {
    it("arraste mais demorado que o limite nao e deslize", () => {
      expect(classifyGesture(swipe(-120, { durationMs: SWIPE_MAX_MS }))).toBe("deslize-esquerda");
      expect(classifyGesture(swipe(-120, { durationMs: SWIPE_MAX_MS + 1 }))).toBeNull();
    });

    it("dedo parado ate o toque longo e depois arrastado nao e deslize", () => {
      expect(
        classifyGesture(swipe(-120, { stillMs: LONG_PRESS_MS - 1, durationMs: 700 }))
      ).toBe("deslize-esquerda");
      expect(
        classifyGesture(swipe(-120, { stillMs: LONG_PRESS_MS, durationMs: 700 }))
      ).toBeNull();
    });
  });

  describe("borda lateral", () => {
    it("deslize que comeca na faixa da borda esquerda e ignorado", () => {
      expect(classifyGesture(swipe(120, { startX: EDGE_GUARD_PX - 1 }))).toBeNull();
      expect(classifyGesture(swipe(120, { startX: EDGE_GUARD_PX }))).toBe("deslize-direita");
    });

    it("deslize que comeca na faixa da borda direita e ignorado", () => {
      expect(classifyGesture(swipe(-120, { startX: WIDTH - EDGE_GUARD_PX + 1 }))).toBeNull();
      expect(classifyGesture(swipe(-120, { startX: WIDTH - EDGE_GUARD_PX }))).toBe(
        "deslize-esquerda"
      );
    });

    it("a faixa acompanha a largura da tela", () => {
      const start = 800 - EDGE_GUARD_PX + 1;
      expect(classifyGesture(swipe(-120, { startX: start, viewportWidth: 800 }))).toBeNull();
      expect(classifyGesture(swipe(-120, { startX: start, viewportWidth: 1200 }))).toBe(
        "deslize-esquerda"
      );
    });

    it("deslize que termina na borda, vindo do meio, vale", () => {
      expect(classifyGesture(swipe(-170, { startX: 180 }))).toBe("deslize-esquerda");
    });
  });
});

describe("movedPastTolerance", () => {
  it("dentro da tolerancia, nos dois eixos, o ponteiro conta como parado", () => {
    expect(movedPastTolerance(100, 100, 100 + MOVE_TOLERANCE_PX, 100 - MOVE_TOLERANCE_PX)).toBe(
      false
    );
  });

  it("um pixel alem da tolerancia em qualquer eixo ja e movimento", () => {
    expect(movedPastTolerance(100, 100, 100 + MOVE_TOLERANCE_PX + 1, 100)).toBe(true);
    expect(movedPastTolerance(100, 100, 100, 100 - MOVE_TOLERANCE_PX - 1)).toBe(true);
  });
});
