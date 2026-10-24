import { describe, expect, it } from "vitest";
import { bookSaveFailure, partTitle, splitChapterText } from "@/lib/epub-text";

describe("capitulo grande dividido em partes (US-180)", () => {
  it("capitulo dentro do limite fica inteiro", () => {
    expect(splitChapterText("um\n\ndois", 100)).toEqual(["um\n\ndois"]);
  });

  it("divide entre paragrafos, sem passar do limite", () => {
    const body = ["a".repeat(40), "b".repeat(40), "c".repeat(40)].join("\n\n");
    const parts = splitChapterText(body, 90);
    expect(parts).toEqual([`${"a".repeat(40)}\n\n${"b".repeat(40)}`, "c".repeat(40)]);
    expect(parts.every((part) => part.length <= 90)).toBe(true);
  });

  it("paragrafo maior que o limite e dividido entre palavras, sem perder texto", () => {
    const body = Array.from({ length: 50 }, (_, i) => `p${i}`).join(" ");
    const parts = splitChapterText(body, 30);
    expect(parts.every((part) => part.length <= 30)).toBe(true);
    expect(parts.join(" ").split(" ")).toEqual(body.split(" "));
  });

  it("nomeia as partes e explica o salvamento interrompido", () => {
    expect(partTitle("Capitulo 1", 1, 1)).toBe("Capitulo 1");
    expect(partTitle("Capitulo 1", 2, 3)).toBe("Capitulo 1 (parte 2 de 3)");
    expect(bookSaveFailure(6, 20)).toBe("6 de 20 capítulos salvos. Tente de novo para continuar.");
  });
});
