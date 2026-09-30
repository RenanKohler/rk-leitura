import { describe, expect, it } from "vitest";
import { countWords } from "@/lib/reading";
import { WELCOME_CONTENT, WELCOME_TITLE } from "@/lib/welcome";

describe("texto de boas-vindas", () => {
  it("e curto: cerca de 250 palavras", () => {
    const words = countWords(WELCOME_CONTENT, "plain");
    expect(words).toBeGreaterThanOrEqual(200);
    expect(words).toBeLessThanOrEqual(320);
  });

  it("explica os gestos do leitor atual", () => {
    for (const trecho of [
      "páginas",
      "Word Runner",
      "toque na palavra do Word Runner",
      "Toque em qualquer palavra da página",
      "deslize",
      "setas do rodapé",
      "Toque e segure",
      "Voltar a frase",
      "Avançar a frase",
    ]) {
      expect(WELCOME_CONTENT).toContain(trecho);
    }
  });

  it("nao fala dos modos antigos", () => {
    expect(WELCOME_CONTENT).not.toMatch(/modo (Foco|Rolagem|Paginas|Páginas)/);
  });

  it("tem titulo", () => {
    expect(WELCOME_TITLE.length).toBeGreaterThan(5);
  });
});
