import { describe, expect, it } from "vitest";
import type { Paragraph } from "@/lib/reading";
import {
  FOLLOW_ANCHOR_FRACTION,
  FOLLOW_EASE_MS,
  FOLLOW_GLIDE_SCREENS,
  followScrollTop,
  followStep,
  marksByParagraph,
  paragraphIndexOf,
  SCROLL_AWAY_WORDS,
  scrolledAway,
  scrollStatus,
  wordInView,
  wordSpanInText,
} from "@/lib/scroll-reading";

const paragraph = (start: number, size: number): Paragraph => ({
  start,
  words: Array.from({ length: size }, (_, i) => `p${start + i}`),
});

// Palavras 0-4, 5-9 e 10-12.
const paragraphs = [paragraph(0, 5), paragraph(5, 5), paragraph(10, 3)];

describe("paragraphIndexOf", () => {
  it("acha o paragrafo da palavra, nas bordas e no meio", () => {
    expect(paragraphIndexOf(paragraphs, 0)).toBe(0);
    expect(paragraphIndexOf(paragraphs, 4)).toBe(0);
    expect(paragraphIndexOf(paragraphs, 5)).toBe(1);
    expect(paragraphIndexOf(paragraphs, 9)).toBe(1);
    expect(paragraphIndexOf(paragraphs, 12)).toBe(2);
  });

  it("fora do texto fica no paragrafo mais proximo", () => {
    expect(paragraphIndexOf(paragraphs, -3)).toBe(0);
    expect(paragraphIndexOf(paragraphs, 99)).toBe(2);
  });

  it("sem paragrafos nao ha onde cair", () => {
    expect(paragraphIndexOf([], 0)).toBe(-1);
  });
});

describe("wordSpanInText", () => {
  it("devolve o trecho da palavra pedida", () => {
    const text = "ler rápido exige atenção";
    expect(wordSpanInText(text, 0)).toEqual({ start: 0, end: 3 });
    expect(wordSpanInText(text, 2)).toEqual({ start: 11, end: 16 });
    expect(text.slice(11, 16)).toBe("exige");
  });

  it("ignora espacos repetidos e nas pontas", () => {
    const text = "  um   dois\ntres ";
    expect(wordSpanInText(text, 0)).toEqual({ start: 2, end: 4 });
    expect(wordSpanInText(text, 1)).toEqual({ start: 7, end: 11 });
    expect(wordSpanInText(text, 2)).toEqual({ start: 12, end: 16 });
  });

  it("palavra que nao existe, ou posicao invalida, e null", () => {
    expect(wordSpanInText("um dois", 2)).toBeNull();
    expect(wordSpanInText("", 0)).toBeNull();
    expect(wordSpanInText("um dois", -1)).toBeNull();
    expect(wordSpanInText("um dois", 0.5)).toBeNull();
  });
});

describe("marksByParagraph", () => {
  const mark = (id: string, start: number, end: number) => ({ id, start, end, note: null });

  it("cada paragrafo recebe so os destaques que o tocam", () => {
    const marks = [mark("a", 1, 3), mark("b", 4, 7), mark("c", 10, 11)];
    const of = marksByParagraph(paragraphs, marks);
    expect(of(paragraphs[0]!).map((item) => item.id)).toEqual(["a", "b"]);
    expect(of(paragraphs[1]!).map((item) => item.id)).toEqual(["b"]);
    expect(of(paragraphs[2]!).map((item) => item.id)).toEqual(["c"]);
  });

  it("destaque que termina onde o paragrafo comeca nao entra nele", () => {
    const of = marksByParagraph(paragraphs, [mark("a", 2, 5)]);
    expect(of(paragraphs[0]!)).toHaveLength(1);
    expect(of(paragraphs[1]!)).toHaveLength(0);
  });

  it("paragrafos sem destaque dividem a mesma lista vazia", () => {
    const of = marksByParagraph(paragraphs, [mark("a", 0, 1)]);
    expect(of(paragraphs[1]!)).toBe(of(paragraphs[2]!));
    expect(marksByParagraph(paragraphs, [])(paragraphs[0]!)).toBe(of(paragraphs[1]!));
  });
});

describe("wordInView", () => {
  const frame = { top: 100, bottom: 700 };

  it("linha inteira dentro da coluna esta a vista", () => {
    expect(wordInView({ top: 300, bottom: 328 }, frame)).toBe(true);
  });

  it("em cima, um pedaco da linha ja conta", () => {
    expect(wordInView({ top: 80, bottom: 108 }, frame)).toBe(true);
    expect(wordInView({ top: 60, bottom: 100 }, frame)).toBe(false);
  });

  it("embaixo, a linha precisa caber inteira", () => {
    expect(wordInView({ top: 672, bottom: 700 }, frame)).toBe(true);
    expect(wordInView({ top: 690, bottom: 718 }, frame)).toBe(false);
    expect(wordInView({ top: 800, bottom: 828 }, frame)).toBe(false);
  });
});

// Rolagem automatica (US-225): quadro de 600 px num texto de 5000 px, com
// linhas de 30 px. A ancora fica a 200 px do topo do quadro.
describe("followScrollTop", () => {
  const line = (lineTop: number, progress = 0) => ({
    lineTop,
    lineHeight: 30,
    progress,
    frameHeight: 600,
    contentHeight: 5000,
  });

  it("poe o topo da linha a um terco do quadro", () => {
    expect(FOLLOW_ANCHOR_FRACTION).toBeCloseTo(1 / 3);
    expect(followScrollTop(line(1000))).toBeCloseTo(800);
    // A linha fica a 200 px do topo do quadro, onde quer que o texto esteja.
    expect(1000 - followScrollTop(line(1000))).toBeCloseTo(200);
    expect(3000 - followScrollTop(line(3000))).toBeCloseTo(200);
  });

  it("sobe a altura de uma linha enquanto o guia a atravessa", () => {
    expect(followScrollTop(line(1000, 0.5))).toBeCloseTo(815);
    expect(followScrollTop(line(1000, 1))).toBeCloseTo(830);
    // O fim de uma linha e o comeco da seguinte dao o mesmo alvo: nao ha
    // salto na troca de linha.
    expect(followScrollTop(line(1000, 1))).toBeCloseTo(followScrollTop(line(1030, 0)));
  });

  it("o progresso fora de 0 a 1, ou que nao e numero, nao tira a linha do lugar", () => {
    expect(followScrollTop(line(1000, -0.4))).toBeCloseTo(800);
    expect(followScrollTop(line(1000, 7))).toBeCloseTo(830);
    expect(followScrollTop(line(1000, Number.NaN))).toBeCloseTo(800);
  });

  it("a ancora acompanha a altura do quadro, que muda com os controles", () => {
    // Controles fora da tela: o quadro cresce e a ancora desce com ele.
    expect(followScrollTop({ ...line(1000), frameHeight: 780 })).toBeCloseTo(740);
    expect(followScrollTop({ ...line(1000), fraction: 0.5 })).toBeCloseTo(700);
  });

  it("no comeco do texto a coluna nao sobe alem do topo", () => {
    expect(followScrollTop(line(0))).toBe(0);
    expect(followScrollTop(line(150))).toBe(0);
    // A partir da linha que chega a ancora, a coluna comeca a andar.
    expect(followScrollTop(line(230))).toBeCloseTo(30);
  });

  it("no fim para no fundo, com o bloco de concluir a vista", () => {
    // O fundo e 5000 - 600: dali para a frente o guia desce pela tela.
    expect(followScrollTop(line(4590))).toBeCloseTo(4390);
    expect(followScrollTop(line(4700))).toBe(4400);
    expect(followScrollTop(line(4950, 1))).toBe(4400);
  });

  it("texto que cabe inteiro no quadro nao rola", () => {
    expect(followScrollTop({ ...line(300), contentHeight: 450 })).toBe(0);
  });
});

describe("followStep", () => {
  const frame = 600;

  it("anda uma parte do que falta, sem passar do alvo", () => {
    const next = followStep(100, 200, 16, frame);
    expect(next).toBeGreaterThan(100);
    expect(next).toBeLessThan(200);
    // Para tras vale o mesmo.
    const back = followStep(200, 100, 16, frame);
    expect(back).toBeLessThan(200);
    expect(back).toBeGreaterThan(100);
  });

  it("depois de uma constante de tempo venceu cerca de dois tercos do caminho", () => {
    expect(followStep(0, 100, FOLLOW_EASE_MS, frame)).toBeCloseTo(100 * (1 - Math.exp(-1)));
  });

  it("da no mesmo lugar com muitos quadros curtos ou poucos quadros longos", () => {
    let fast = 0;
    for (let frames = 0; frames < 12; frames += 1) fast = followStep(fast, 100, 8, frame);
    let slow = 0;
    for (let frames = 0; frames < 3; frames += 1) slow = followStep(slow, 100, 32, frame);
    expect(fast).toBeCloseTo(slow);
  });

  it("chega ao alvo e fica nele", () => {
    let top = 0;
    for (let frames = 0; frames < 600; frames += 1) top = followStep(top, 100, 16, frame);
    expect(top).toBe(100);
    expect(followStep(100, 100, 16, frame)).toBe(100);
    // A um fio do alvo, encosta de vez em vez de se aproximar para sempre.
    expect(followStep(99.99, 100, 16, frame)).toBe(100);
  });

  it("sem tempo passado nao sai do lugar", () => {
    expect(followStep(100, 200, 0, frame)).toBe(100);
    expect(followStep(100, 200, -5, frame)).toBe(100);
  });

  it("com o alvo andando no ritmo da leitura, o movimento e constante", () => {
    // 60 px por segundo: 1 px por quadro de 16,7 ms.
    let top = 0;
    const steps: number[] = [];
    for (let frames = 1; frames <= 600; frames += 1) {
      const next = followStep(top, frames, 1000 / 60, frame);
      steps.push(next - top);
      top = next;
    }
    // Passada a largada, cada quadro anda o mesmo tanto que o alvo.
    for (const step of steps.slice(-60)) expect(step).toBeCloseTo(1, 2);
    // E a coluna fica uma distancia fixa atras dele: velocidade vezes a
    // constante de tempo (60 px/s por 0,4 s).
    expect(600 - top).toBeGreaterThan(20);
    expect(600 - top).toBeLessThan(28);
  });

  it("de muito longe encosta a uma tela e meia do alvo e desliza so o fim", () => {
    const reach = frame * FOLLOW_GLIDE_SCREENS;
    const next = followStep(0, 50_000, 16, frame);
    expect(next).toBeGreaterThanOrEqual(50_000 - reach);
    expect(next).toBeLessThan(50_000);
    // Vindo de baixo, o mesmo.
    const back = followStep(50_000, 1000, 16, frame);
    expect(back).toBeLessThanOrEqual(1000 + reach);
    expect(back).toBeGreaterThan(1000);
    // Dentro do alcance nao ha salto: so o deslize.
    expect(followStep(1000, 1000 + reach, 16, frame)).toBeLessThan(1000 + reach * 0.1);
  });
});

describe("scrolledAway", () => {
  it("perto do lugar da leitura, para tras ou para a frente, nao e longe", () => {
    expect(scrolledAway(1000, 1000)).toBe(false);
    expect(scrolledAway(1000 - SCROLL_AWAY_WORDS, 1000)).toBe(false);
    expect(scrolledAway(1000 + SCROLL_AWAY_WORDS, 1000)).toBe(false);
  });

  it("uma palavra alem do limite ja e longe, nos dois sentidos", () => {
    expect(scrolledAway(1000 - SCROLL_AWAY_WORDS - 1, 1000)).toBe(true);
    expect(scrolledAway(1000 + SCROLL_AWAY_WORDS + 1, 1000)).toBe(true);
  });
});

describe("scrollStatus", () => {
  it("mostra o quanto do texto ja passou", () => {
    expect(scrollStatus(0, 1000)).toBe("0%");
    expect(scrollStatus(420, 1000)).toBe("42%");
    expect(scrollStatus(1000, 1000)).toBe("100%");
  });

  it("nao passa de 100% nem quebra em texto vazio", () => {
    expect(scrollStatus(1500, 1000)).toBe("100%");
    expect(scrollStatus(0, 0)).toBe("0%");
  });
});
