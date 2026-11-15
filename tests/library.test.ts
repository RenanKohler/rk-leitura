import { describe, expect, it } from "vitest";
import {
  asLibraryOrder,
  DEFAULT_LIBRARY_ORDER,
  LIBRARY_ORDER_COOKIE,
  LIBRARY_ORDER_OPTIONS,
  LIBRARY_ORDERS,
  readingState,
  readingStateLabel,
  sizeLabel,
  tagCountsApply,
  visibleTags,
} from "@/lib/library";
import { estimatedMinutes } from "@/lib/reading";
import type { TagSummary } from "@/lib/types";

/** Regras da lista da biblioteca (US-230). */

describe("ordem da biblioteca", () => {
  it("o padrao e a ultima leitura", () => {
    expect(DEFAULT_LIBRARY_ORDER).toBe("leitura");
  });

  it("aceita as duas ordens conhecidas", () => {
    expect(asLibraryOrder("leitura")).toBe("leitura");
    expect(asLibraryOrder("importacao")).toBe("importacao");
  });

  it("ausente, vazio ou desconhecido cai no padrao", () => {
    // `searchParams.get` devolve null, o cookie ausente devolve undefined, e
    // o `localStorage` pode guardar o valor de uma versao antiga.
    for (const value of [null, undefined, "", "Leitura", "importação", "created_at desc", 1, {}]) {
      expect(asLibraryOrder(value)).toBe("leitura");
    }
  });

  it("o controle oferece exatamente as ordens que a rota aceita", () => {
    expect(LIBRARY_ORDER_OPTIONS.map((option) => option.value)).toEqual([...LIBRARY_ORDERS]);
    expect(LIBRARY_ORDER_OPTIONS.map((option) => option.label)).toEqual([
      "Última leitura",
      "Data de importação",
    ]);
  });

  it("o nome do cookie so tem caracteres que um cookie aceita", () => {
    // Dois-pontos, como nas chaves do localStorage, nao valem em nome de cookie.
    expect(LIBRARY_ORDER_COOKIE).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("estado da leitura no item", () => {
  it("parado no inicio nao tem rotulo", () => {
    const state = readingState({ progressIndex: 0, wordCount: 500 });
    expect(state).toEqual({ kind: "nao-lido" });
    expect(readingStateLabel(state)).toBeNull();
  });

  it("importado sozinho e ainda nao aberto e novo", () => {
    const state = readingState({ progressIndex: 0, wordCount: 500, fresh: true });
    expect(state).toEqual({ kind: "novo" });
    expect(readingStateLabel(state)).toBe("Novo");
  });

  it("em andamento mostra a porcentagem", () => {
    const state = readingState({ progressIndex: 175, wordCount: 500 });
    expect(state).toEqual({ kind: "lendo", percent: 35 });
    expect(readingStateLabel(state)).toBe("35% lido");
  });

  it("comecado nunca aparece com 0%, nem inacabado com 100%", () => {
    // 2 de 1000 arredonda para 0 e 998 de 1000 para 100: os dois continuam
    // em andamento, e o indicador de progresso tem de aparecer.
    expect(readingState({ progressIndex: 2, wordCount: 1000 })).toEqual({
      kind: "lendo",
      percent: 1,
    });
    expect(readingState({ progressIndex: 998, wordCount: 1000 })).toEqual({
      kind: "lendo",
      percent: 99,
    });
  });

  it("no fim e lido, mesmo com a posicao alem da contagem", () => {
    expect(readingState({ progressIndex: 500, wordCount: 500 })).toEqual({ kind: "lido" });
    expect(readingState({ progressIndex: 620, wordCount: 500 })).toEqual({ kind: "lido" });
    expect(readingStateLabel({ kind: "lido" })).toBe("Lido");
  });

  it("a leitura comecada vence a marca de novo", () => {
    expect(readingState({ progressIndex: 50, wordCount: 500, fresh: true })).toEqual({
      kind: "lendo",
      percent: 10,
    });
  });

  it("texto vazio nunca conta como lido", () => {
    expect(readingState({ progressIndex: 0, wordCount: 0 })).toEqual({ kind: "nao-lido" });
  });
});

describe("tamanho do texto", () => {
  it("junta palavras e minutos na velocidade do leitor", () => {
    expect(sizeLabel(1200, 300)).toBe(`1.200 palavras · ~${estimatedMinutes(1200, 300)} min`);
  });

  it("texto curto leva pelo menos um minuto", () => {
    expect(sizeLabel(40, 300)).toBe("40 palavras · ~1 min");
  });
});

describe("etiquetas na faixa de filtro", () => {
  const tags: TagSummary[] = [
    { id: "a", name: "Atenção", texts: 0 },
    { id: "b", name: "Estudo", texts: 3 },
    { id: "c", name: "Trabalho", texts: 1 },
  ];

  it("a contagem vale na lista principal, menos no filtro de largados", () => {
    // O servidor conta a lista principal sem largados; os outros filtros de
    // leitura so recortam esse conjunto.
    for (const status of ["todos", "nao-iniciados", "em-andamento", "concluidos"] as const) {
      expect(tagCountsApply("ativos", status)).toBe(true);
    }
    expect(tagCountsApply("ativos", "largados")).toBe(false);
    expect(tagCountsApply("arquivados", "todos")).toBe(false);
  });

  it("onde a contagem vale, sai a etiqueta que nao marca nenhum texto", () => {
    expect(visibleTags(tags, true, null).map((tag) => tag.name)).toEqual(["Estudo", "Trabalho"]);
  });

  it("a etiqueta escolhida fica mesmo zerada, para dar para desligar o filtro", () => {
    expect(visibleTags(tags, true, "a").map((tag) => tag.name)).toEqual([
      "Atenção",
      "Estudo",
      "Trabalho",
    ]);
  });

  it("onde a contagem nao vale entram todas", () => {
    // Uma etiqueta so com textos arquivados ou largados tem zero na contagem
    // e ainda assim filtra a lista que esta na tela.
    expect(visibleTags(tags, false, null)).toEqual(tags);
  });
});
