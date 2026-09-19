import { describe, expect, it } from "vitest";
import { cleanTitle, detectSeries, nextChapterUrl, seriesProgress } from "@/lib/series";

describe("detectSeries pelo endereco", () => {
  it("le o padrao do Literotica", () => {
    const match = detectSeries(
      "The Cabin Ch. 02",
      "https://www.literotica.com/s/the-cabin-ch-02"
    )!;
    expect(match.chapter).toBe(2);
    expect(match.key).toBe("url:the-cabin");
    expect(match.title).toBe("The Cabin");
  });

  it("capitulos da mesma historia compartilham a chave", () => {
    const um = detectSeries("A Cabana Ch. 01", "https://exemplo.com/s/a-cabana-ch-01")!;
    const dois = detectSeries("A Cabana Ch. 02", "https://exemplo.com/s/a-cabana-ch-02")!;
    expect(um.key).toBe(dois.key);
    expect([um.chapter, dois.chapter]).toEqual([1, 2]);
  });

  it("aceita as variacoes do separador", () => {
    for (const slug of ["conto-ch02", "conto-chapter-2", "conto-parte-2", "conto-pt-2"]) {
      const match = detectSeries("Conto", `https://exemplo.com/${slug}`);
      expect(match?.chapter, slug).toBe(2);
    }
  });

  it("o endereco vence o titulo quando os dois tem marca", () => {
    const match = detectSeries("Outro Nome Ch. 09", "https://exemplo.com/a-cabana-ch-02")!;
    expect(match.chapter).toBe(2);
    expect(match.key).toBe("url:a-cabana");
  });

  it("ignora numero que nao e capitulo", () => {
    expect(detectSeries("1984", "https://exemplo.com/1984")).toBeNull();
    expect(detectSeries("Artigo", "https://exemplo.com/artigo-2024")).toBeNull();
  });

  it("endereco invalido nao quebra a deteccao", () => {
    expect(detectSeries("Conto", "nao-e-url")).toBeNull();
  });
});

describe("detectSeries pelo titulo", () => {
  it("le 'Ch. 02' no fim do titulo", () => {
    const match = detectSeries("A cabana no inverno Ch. 02", null)!;
    expect(match.chapter).toBe(2);
    expect(match.title).toBe("A cabana no inverno");
    expect(match.key).toBe("titulo:a cabana no inverno");
  });

  it("le numeral romano", () => {
    expect(detectSeries("A cabana - Parte IV", null)!.chapter).toBe(4);
    expect(detectSeries("A cabana - Parte IX", null)!.chapter).toBe(9);
  });

  it("a chave ignora caixa e acento", () => {
    const a = detectSeries("A Ilusão Ch. 1", null)!;
    const b = detectSeries("a ilusao Ch. 2", null)!;
    expect(a.key).toBe(b.key);
  });

  it("nao confunde numero colado no nome", () => {
    expect(detectSeries("Apollo 11", null)).toBeNull();
    expect(detectSeries("Fahrenheit 451", null)).toBeNull();
  });

  it("titulo que e so a marca nao vira serie", () => {
    expect(detectSeries("Ch. 02", null)).toBeNull();
  });

  it("capitulo fora da faixa e descartado", () => {
    expect(detectSeries("Conto Ch. 0", null)).toBeNull();
    expect(detectSeries("Conto Ch. 9999", null)).toBeNull();
  });
});

describe("cleanTitle", () => {
  it("tira a marca de capitulo", () => {
    expect(cleanTitle("A cabana Ch. 02")).toBe("A cabana");
    expect(cleanTitle("A cabana - Parte 3")).toBe("A cabana");
  });

  it("deixa intacto o titulo sem marca", () => {
    expect(cleanTitle("A cabana no inverno")).toBe("A cabana no inverno");
  });
});

describe("nextChapterUrl", () => {
  it("avanca o capitulo preservando os zeros a esquerda", () => {
    expect(nextChapterUrl("https://www.literotica.com/s/the-cabin-ch-02", 2)).toBe(
      "https://www.literotica.com/s/the-cabin-ch-03"
    );
  });

  it("avanca sem zeros quando a origem nao usa", () => {
    expect(nextChapterUrl("https://exemplo.com/conto-ch-9", 9)).toBe(
      "https://exemplo.com/conto-ch-10"
    );
  });

  it("descarta a pagina dentro do capitulo", () => {
    expect(nextChapterUrl("https://exemplo.com/conto-ch-01?page=4", 1)).toBe(
      "https://exemplo.com/conto-ch-02"
    );
  });

  it("sem padrao no endereco nao ha o que adivinhar", () => {
    expect(nextChapterUrl("https://exemplo.com/conto", 1)).toBeNull();
    expect(nextChapterUrl(null, 1)).toBeNull();
    expect(nextChapterUrl("nao-e-url", 1)).toBeNull();
  });
});

describe("seriesProgress", () => {
  it("descreve a posicao na serie", () => {
    expect(seriesProgress(3, 7)).toBe("cap. 3 de 7");
  });
});
