import { describe, expect, it } from "vitest";
import { matchKeys } from "@/lib/passage-match";
import { parseParagraphs } from "@/lib/reading";
import {
  MAX_NOTES_ITEMS,
  notesCount,
  notesFileName,
  notesKey,
  notesMarkdown,
  parseStoredNotes,
  validNotes,
  type StudyNotes,
} from "@/lib/study-notes";

const { words } = parseParagraphs(
  "A leitura lenta melhora a compreensao. Estudos mostram ganho de vinte por cento.\n\nPortanto vale ler devagar textos dificeis."
);
const keys = matchKeys(words);

describe("validNotes", () => {
  it("mantem so itens com citacao literal e mapeia a posicao", () => {
    const notes = validNotes(
      {
        ideia: [{ text: "Ler devagar ajuda.", quote: "A leitura lenta melhora a compreensão." }],
        argumentos: [{ text: "Inventado.", quote: "frase que nao existe no texto" }],
        evidencias: [{ text: "Há um estudo.", quote: "“Estudos mostram ganho de vinte por cento”" }],
        conclusoes: [{ text: "Vale ler devagar.", quote: "Portanto vale ler devagar" }],
      },
      words,
      keys,
      0,
      words.length
    );
    expect(notes.argumentos).toEqual([]);
    expect(notes.evidencias[0]).toMatchObject({
      quote: "Estudos mostram ganho de vinte por cento.",
      start: words.indexOf("Estudos"),
    });
    expect(notes.conclusoes[0]!.start).toBe(words.indexOf("Portanto"));
    expect(notesCount(notes)).toBe(2);
    // "compreensão" com acento nao e a palavra do texto.
    expect(notes.ideia).toEqual([]);
  });

  it("limita a 6 itens por secao e aceita resposta vazia", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ text: `Item ${i}`, quote: "Portanto vale ler devagar" }));
    expect(validNotes({ argumentos: many }, words, keys, 0, words.length).argumentos).toHaveLength(MAX_NOTES_ITEMS);
    expect(notesCount(validNotes(null, words, keys, 0, words.length))).toBe(0);
  });
});

describe("exportacao", () => {
  const notes: StudyNotes = {
    ideia: [{ text: "Ler devagar ajuda.", quote: "A leitura lenta melhora a compreensao.", start: 0, end: 6 }],
    argumentos: [],
    evidencias: [],
    conclusoes: [{ text: "Vale ler devagar.", quote: "Portanto vale ler devagar", start: 14, end: 18 }],
  };

  it("segue o formato da exportacao de destaques", () => {
    const markdown = notesMarkdown({ title: "Leitura lenta", sourceUrl: "https://exemplo.com/a" }, notes);
    expect(markdown.startsWith("# Leitura lenta\n\nOrigem: <https://exemplo.com/a>\n")).toBe(true);
    expect(markdown).toContain("## Ideia central\n\n- Ler devagar ajuda.\n\n> A leitura lenta melhora a compreensao.\n");
    expect(markdown).toContain("## Argumentos\n\n_Nada nesta seção._");
    expect(markdown).toContain("## Evidências");
    expect(markdown).toContain("## Conclusões\n\n- Vale ler devagar.\n\n> Portanto vale ler devagar");
  });

  it("nome do arquivo e chave", () => {
    expect(notesFileName("Leitura Lenta")).toBe("leitura-lenta-fichamento.md");
    expect(notesKey("t", "f")).toBe("t:f");
  });

  it("le o guardado", () => {
    expect(parseStoredNotes(notes)).toEqual(notes);
    expect(parseStoredNotes({ ideia: [] })).toBeNull();
  });
});
