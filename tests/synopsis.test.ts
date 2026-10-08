import { describe, expect, it } from "vitest";
import {
  canAskSynopsis,
  clampSynopsis,
  MAX_SYNOPSIS_CHARS,
  synopsisExcerpt,
} from "@/lib/synopsis";

/**
 * A sinopse nao revela o desenrolar porque o modelo so ve o comeco (US-138,
 * criterio 3): os primeiros 15% do texto, com no maximo 20 mil caracteres.
 */

const palavras = (total: number, tamanho = 1) =>
  Array.from({ length: total }, (_, index) => `${"w".repeat(tamanho)}${index}`);

describe("synopsisExcerpt", () => {
  it("envia os primeiros 15% das palavras e nada depois", () => {
    const lista = palavras(1000);
    const recorte = synopsisExcerpt(lista.join(" "));
    expect(recorte.split(" ")).toEqual(lista.slice(0, 150));
  });

  it("arredonda para cima em texto curto", () => {
    expect(synopsisExcerpt(palavras(10).join(" ")).split(" ")).toEqual(["w0", "w1"]);
  });

  it("preserva os paragrafos do comeco", () => {
    const texto = `${palavras(10).join(" ")}\n\n${palavras(90).join(" ")}`;
    expect(synopsisExcerpt(texto)).toBe(`${palavras(10).join(" ")}\n\n${palavras(5).join(" ")}`);
  });

  it("nao passa de 20 mil caracteres em texto longo e para em palavra inteira", () => {
    const lista = palavras(200_000, 5);
    const recorte = synopsisExcerpt(lista.join(" "));
    expect(recorte.length).toBeLessThanOrEqual(MAX_SYNOPSIS_CHARS);
    expect(recorte.length).toBeGreaterThan(MAX_SYNOPSIS_CHARS - 20);
    const enviadas = recorte.split(" ");
    expect(enviadas).toEqual(lista.slice(0, enviadas.length));
  });

  it("texto vazio nao envia nada", () => {
    expect(synopsisExcerpt("   ")).toBe("");
  });
});

describe("canAskSynopsis", () => {
  it("so para texto nao iniciado com pelo menos 200 palavras", () => {
    expect(canAskSynopsis({ wordCount: 200, progressIndex: 0 })).toBe(true);
    expect(canAskSynopsis({ wordCount: 199, progressIndex: 0 })).toBe(false);
    expect(canAskSynopsis({ wordCount: 5000, progressIndex: 1 })).toBe(false);
  });
});

describe("clampSynopsis", () => {
  it("mantem a sinopse curta como veio, sem espaco sobrando", () => {
    expect(clampSynopsis("  Uma   historia de verao. ")).toBe("Uma historia de verao.");
  });

  it("corta em 50 palavras e fecha com reticencias", () => {
    const curta = clampSynopsis(palavras(80).join(" "));
    expect(curta.replace("…", "").split(" ")).toHaveLength(50);
    expect(curta.endsWith("…")).toBe(true);
  });
});
