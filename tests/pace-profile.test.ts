import { describe, expect, it } from "vitest";
import { fitParagraphEnd } from "@/lib/pacing";
import {
  asPaceProfile,
  buildPaceProfile,
  fitProfileEnd,
  PACE_PROFILE_VERSION,
} from "@/lib/pace-profile";
import { asTextFormat, parseParagraphs } from "@/lib/reading";

/**
 * Tempo livre sem o conteudo (US-209): a previsao pelo perfil gravado tem de
 * escolher os mesmos trechos que a previsao com o texto.
 */

const VOCABULARY = (
  "a leitura profunda exige atenção sustentada durante longos períodos e o leitor " +
  "acompanha argumentos complexos relacionando ideias anteriores com conclusões novas " +
  "enquanto a memória de trabalho organiza conceitos interdependentes"
).split(" ");

/** Texto deterministico com virgulas, frases e paragrafos de tamanhos variados. */
function prose(paragraphs: number, seed = 7): string {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const blocks: string[] = [];
  for (let p = 0; p < paragraphs; p += 1) {
    const sentences: string[] = [];
    const count = 2 + Math.floor(next() * 4);
    for (let s = 0; s < count; s += 1) {
      const size = 6 + Math.floor(next() * 18);
      const words = Array.from(
        { length: size },
        () => VOCABULARY[Math.floor(next() * VOCABULARY.length)]!,
      );
      if (size > 10) words[Math.floor(size / 2)] += ",";
      words[0] = words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1);
      sentences.push(`${words.join(" ")}${next() < 0.15 ? "?" : "."}`);
    }
    blocks.push(sentences.join(" "));
  }
  return blocks.join("\n\n");
}

const MARKDOWN = [
  "# Atenção e leitura",
  prose(3, 11),
  "## Como praticar",
  "- Ler em blocos de vinte minutos, sem notificações.",
  "- Anotar a ideia central de cada seção.",
  "- Revisar no dia seguinte.",
  prose(4, 23),
].join("\n\n");

const CASES = [
  { name: "prosa", content: prose(40), format: "plain" },
  { name: "markdown", content: MARKDOWN, format: "markdown" },
];

function oldVersion(
  content: string,
  format: string,
  from: number,
  budget: number,
  wpm: number,
  warmup: boolean,
  adaptive: boolean,
) {
  const { words, paragraphs } = parseParagraphs(content, asTextFormat(format));
  return fitParagraphEnd(paragraphs, from, budget, wpm, warmup, {
    words,
    adaptive,
    language: "pt",
  });
}

describe("perfil de ritmo do texto", () => {
  for (const { name, content, format } of CASES) {
    const profile = buildPaceProfile(content, format, "pt");
    const total = parseParagraphs(content, asTextFormat(format)).words.length;

    it(`${name}: os paragrafos inteiros terminam no mesmo lugar e no mesmo tempo`, () => {
      expect(profile.ends.at(-1)).toBe(total);
      for (const minutes of [0.5, 1, 2, 3, 5]) {
        for (const adaptive of [true, false]) {
          const before = oldVersion(
            content,
            format,
            0,
            minutes * 60_000,
            280,
            false,
            adaptive,
          );
          const after = fitProfileEnd(
            profile,
            0,
            minutes * 60_000,
            280,
            false,
            adaptive,
          );
          expect(after?.end).toBe(before?.end);
          if (before && after)
            expect(after.predictedMs).toBeCloseTo(before.predictedMs, -1);
        }
      }
    });

    it(`${name}: com a rampa e no meio de um paragrafo, as mesmas sugestoes`, () => {
      // No paragrafo em que a leitura parou e na rampa, o perfil conta pela
      // media do paragrafo: a previsao difere em menos de 2%. Um trecho so
      // muda quando o tempo pedido cai dentro dessa margem do fim de um
      // paragrafo - e entao o trecho do texto tem de estar colado no limite.
      let compared = 0;
      for (const from of [
        0,
        3,
        17,
        Math.floor(total / 3),
        Math.floor(total / 2) + 7,
      ]) {
        for (const minutes of [1, 1.5, 2, 3, 4, 6, 8]) {
          for (const wpm of [200, 250, 300, 450]) {
            const budget = minutes * 60_000;
            const label = `de ${from}, ${minutes} min, ${wpm} ppm`;
            const before = oldVersion(
              content,
              format,
              from,
              budget,
              wpm,
              true,
              true,
            );
            const after = fitProfileEnd(profile, from, budget, wpm, true, true);
            expect(Boolean(after), label).toBe(Boolean(before));
            if (!before || !after) continue;
            if (after.end !== before.end) {
              // O limite estava dentro da margem: com 2% a mais ou a menos de tempo, o
              // texto escolheria um ou outro.
              const edge = Math.max(after.end, before.end);
              const wider = oldVersion(
                content,
                format,
                from,
                budget * 1.02,
                wpm,
                true,
                true,
              );
              expect(wider!.end, label).toBeGreaterThanOrEqual(edge);
              const narrower = oldVersion(
                content,
                format,
                from,
                budget * 0.98,
                wpm,
                true,
                true,
              );
              expect(narrower!.end, label).toBeLessThan(edge);
            } else {
              const drift =
                Math.abs(after.predictedMs - before.predictedMs) /
                before.predictedMs;
              expect(drift, label).toBeLessThan(0.02);
              compared += 1;
            }
          }
        }
      }
      expect(compared).toBeGreaterThan(40);
    });
  }

  it("perfil de outra versao ou incompleto e refeito", () => {
    const profile = buildPaceProfile(prose(2), "plain", "pt");
    expect(asPaceProfile(profile)).toEqual(profile);
    expect(
      asPaceProfile({ ...profile, v: PACE_PROFILE_VERSION + 1 }),
    ).toBeNull();
    expect(asPaceProfile({ ...profile, weights: [] })).toBeNull();
    expect(asPaceProfile(null)).toBeNull();
  });

  it("o perfil e bem menor que o conteudo", () => {
    const content = prose(40);
    expect(
      JSON.stringify(buildPaceProfile(content, "plain", "pt")).length,
    ).toBeLessThan(content.length / 3);
  });
});
