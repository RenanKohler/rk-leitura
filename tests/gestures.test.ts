import { describe, expect, it } from "vitest";
import {
  classifyGesture,
  EDGE_GUARD_PX,
  isHorizontalDrag,
  speedFromDrag,
  speedSteps,
  startsAtEdge,
  SWIPE_MIN_PX,
  TAP_MAX_MOVE_PX,
} from "@/lib/gestures";
import { CHAPTER_PULSE, hapticPattern, SECTION_PULSE, startsHeading } from "@/lib/haptics";
import { MAX_WPM, MIN_WPM, parseParagraphs } from "@/lib/reading";

const WIDTH = 412;
const at = (x: number, y = 400) => ({ x, y });

describe("classifyGesture (US-210, US-211)", () => {
  it("movimento dentro da tolerancia e toque", () => {
    expect(classifyGesture(at(200), at(200 + TAP_MAX_MOVE_PX, 400 - TAP_MAX_MOVE_PX), WIDTH)).toBe("tap");
  });

  it("toque na borda continua sendo toque", () => {
    expect(classifyGesture(at(5), at(7), WIDTH)).toBe("tap");
  });

  it("deslize de 60 px para a esquerda avanca", () => {
    expect(classifyGesture(at(300), at(300 - SWIPE_MIN_PX), WIDTH)).toBe("swipe-left");
  });

  it("deslize de 60 px para a direita volta", () => {
    expect(classifyGesture(at(100), at(100 + SWIPE_MIN_PX), WIDTH)).toBe("swipe-right");
  });

  it("menos de 60 px nao vira", () => {
    expect(classifyGesture(at(300), at(300 - SWIPE_MIN_PX + 1), WIDTH)).toBe("none");
  });

  it("vertical maior ou igual a horizontal nao vira", () => {
    expect(classifyGesture(at(300, 300), at(220, 390), WIDTH)).toBe("none");
    expect(classifyGesture(at(300, 300), at(220, 380), WIDTH)).toBe("none");
    expect(classifyGesture(at(300, 300), at(220, 379), WIDTH)).toBe("swipe-left");
  });

  it("deslize que comeca na borda e do sistema (voltar do Android)", () => {
    expect(classifyGesture(at(EDGE_GUARD_PX - 1), at(EDGE_GUARD_PX + 100), WIDTH)).toBe("none");
    expect(classifyGesture(at(WIDTH - EDGE_GUARD_PX + 1), at(WIDTH - 150), WIDTH)).toBe("none");
    expect(classifyGesture(at(EDGE_GUARD_PX), at(EDGE_GUARD_PX + 100), WIDTH)).toBe("swipe-right");
  });
});

describe("startsAtEdge e isHorizontalDrag", () => {
  it("reserva 24 px de cada lado", () => {
    expect(startsAtEdge(23, WIDTH)).toBe(true);
    expect(startsAtEdge(24, WIDTH)).toBe(false);
    expect(startsAtEdge(WIDTH - 24, WIDTH)).toBe(false);
    expect(startsAtEdge(WIDTH - 23, WIDTH)).toBe(true);
  });

  it("arraste horizontal precisa passar da tolerancia e dominar a vertical", () => {
    expect(isHorizontalDrag(at(100), at(100 + TAP_MAX_MOVE_PX))).toBe(false);
    expect(isHorizontalDrag(at(100), at(100 + TAP_MAX_MOVE_PX + 1))).toBe(true);
    expect(isHorizontalDrag(at(100, 100), at(130, 140))).toBe(false);
  });
});

describe("velocidade por deslize (US-212)", () => {
  it("25 ppm a cada 40 px percorridos", () => {
    expect(speedSteps(39)).toBe(0);
    expect(speedSteps(40)).toBe(1);
    expect(speedSteps(119)).toBe(2);
    expect(speedSteps(-40)).toBe(-1);
    expect(speedSteps(-79)).toBe(-1);
    expect(speedFromDrag(300, 80)).toBe(350);
    expect(speedFromDrag(300, -120)).toBe(225);
  });

  it("respeita MIN_WPM e MAX_WPM", () => {
    expect(speedFromDrag(MIN_WPM, -400)).toBe(MIN_WPM);
    expect(speedFromDrag(MAX_WPM - 10, 400)).toBe(MAX_WPM);
  });
});

describe("vibracao ao mudar de secao (US-216)", () => {
  const { paragraphs } = parseParagraphs("Texto de abertura.\n\n## Segunda parte\n\nCorpo da parte.", "markdown");

  it("so vibra na primeira palavra de um titulo", () => {
    const heading = paragraphs.find((paragraph) => paragraph.kind === "h2")!;
    expect(startsHeading(paragraphs, heading.start)).toBe(true);
    expect(startsHeading(paragraphs, heading.start + 1)).toBe(false);
    expect(startsHeading(paragraphs, 1)).toBe(false);
  });

  it("uma vibracao curta na secao, duas no fim do capitulo", () => {
    const on = { enabled: true, narrating: false };
    expect(hapticPattern("secao", on)).toBe(SECTION_PULSE);
    expect(SECTION_PULSE).toBe(30);
    expect(hapticPattern("capitulo", on)).toEqual(CHAPTER_PULSE);
    expect(CHAPTER_PULSE.filter((_, i) => i % 2 === 0)).toHaveLength(2);
  });

  it("desligada, sem evento ou durante a narracao nao vibra", () => {
    expect(hapticPattern("secao", { enabled: false, narrating: false })).toBeNull();
    expect(hapticPattern(null, { enabled: true, narrating: false })).toBeNull();
    expect(hapticPattern("secao", { enabled: true, narrating: true })).toBeNull();
  });
});
