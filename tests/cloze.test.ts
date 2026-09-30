import { describe, expect, it } from "vitest";
import {
  bareWord,
  BLANK,
  buildCloze,
  heaviestWordIndex,
  isContentWord,
  MIN_CLOZE_LETTERS,
  passageRange,
  sentencesOf,
} from "@/lib/cloze";
import { tokenize } from "@/lib/reading";

const passage = tokenize(`
A pescadora saiu cedo para o mar enquanto a cidade ainda dormia tranquila.
Carregava uma rede remendada e uma garrafa de cafe quente embaixo do braco.
No meio da travessia, o vento mudou de direcao e o barco balancou perigosamente.
Ela segurou o leme com firmeza e esperou a tempestade passar sem desespero.
Quando o sol voltou, havia peixes prateados pulando ao redor da pequena embarcacao.
Maria voltou para casa contente, com historias novas para contar aos vizinhos curiosos.
`);

describe("perguntas de lacuna", () => {
  it("monta de 2 a 3 perguntas com 4 alternativas e uma lacuna", () => {
    const questions = buildCloze(passage, { seed: "texto-1" });
    expect(questions.length).toBeGreaterThanOrEqual(2);
    expect(questions.length).toBeLessThanOrEqual(3);
    for (const question of questions) {
      expect(question.choices).toHaveLength(4);
      expect(new Set(question.choices).size).toBe(4);
      expect(question.prompt).toContain(BLANK);
      const answer = question.choices[question.answer]!;
      // A resposta e a palavra que estava na frase original.
      expect(question.evidence).toContain(answer);
      expect(question.prompt.replace(BLANK, answer)).toBe(question.evidence);
    }
  });

  it("esconde palavra de conteudo longa, nunca nome proprio nem comeco de frase", () => {
    const questions = buildCloze(passage, { seed: "texto-2" });
    for (const question of questions) {
      const answer = question.choices[question.answer]!;
      expect(answer.length).toBeGreaterThanOrEqual(MIN_CLOZE_LETTERS);
      expect(answer).toBe(answer.toLowerCase());
      expect(question.prompt.startsWith(BLANK)).toBe(false);
    }
  });

  it("alternativas vem do proprio texto e tem tamanho parecido", () => {
    const vocabulary = new Set(passage.map((token) => bareWord(token)));
    for (const question of buildCloze(passage, { seed: "texto-3" })) {
      const answer = question.choices[question.answer]!;
      for (const choice of question.choices) {
        expect(vocabulary.has(choice)).toBe(true);
        expect(Math.abs(choice.length - answer.length)).toBeLessThanOrEqual(2);
      }
    }
  });

  it("a mesma semente monta as mesmas perguntas; outra semente pode mudar", () => {
    expect(buildCloze(passage, { seed: "a" })).toEqual(buildCloze(passage, { seed: "a" }));
  });

  it("texto repetido nao gera duas perguntas da mesma frase", () => {
    for (const seed of ["s1", "s2", "s3", "s4"]) {
      const questions = buildCloze([...passage, ...passage], { seed });
      const sentences = questions.map((question) => question.evidence);
      expect(new Set(sentences).size).toBe(sentences.length);
    }
  });

  it("trecho sem material devolve menos de duas perguntas", () => {
    expect(buildCloze(tokenize("Oi. Tudo bem? Sim."), { seed: "x" })).toEqual([]);
  });

  it("palavras funcionais longas nao contam como conteudo", () => {
    expect(isContentWord("porque")).toBe(false);
    expect(isContentWord("tambem")).toBe(false);
    expect(isContentWord("pescadora")).toBe(true);
    expect(isContentWord("mar")).toBe(false);
  });

  it("divide frases preservando o indice de inicio", () => {
    const sentences = sentencesOf(tokenize("Um dois. Tres quatro! Cinco"), 10);
    expect(sentences.map((s) => s.start)).toEqual([10, 12, 14]);
  });
});

describe("trecho lido", () => {
  it("volta as palavras lidas a partir da posicao salva", () => {
    expect(passageRange(1000, 600, 300)).toEqual({ from: 300, to: 600 });
  });

  it("alarga trecho curto ate o minimo", () => {
    expect(passageRange(1000, 600, 20)).toEqual({ from: 520, to: 600 });
  });

  it("sem sessao ou no inicio vale o texto inteiro", () => {
    expect(passageRange(500, 0, 200)).toEqual({ from: 0, to: 500 });
    expect(passageRange(500, 300, null)).toEqual({ from: 0, to: 500 });
  });
});

describe("palavra de maior peso do destaque", () => {
  it("escolhe a palavra de conteudo mais longa", () => {
    const words = tokenize("a memoria de trabalho guarda pouca informacao");
    expect(words[heaviestWordIndex(words)!]).toBe("informacao");
  });

  it("ignora nome proprio no meio do trecho", () => {
    const words = tokenize("o livro de Dostoievski sobre culpa");
    expect(words[heaviestWordIndex(words)!]).toBe("livro");
  });

  it("nulo quando nada serve", () => {
    expect(heaviestWordIndex(tokenize("e o que"))).toBeNull();
  });
});
