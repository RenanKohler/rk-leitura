import { describe, expect, it } from "vitest";
import {
  DELETED_TEXT,
  featureLabel,
  outcomeLabel,
  textLabel,
  UNRECORDED_TEXT,
} from "@/lib/ai-history";

describe("historico de envios (US-144)", () => {
  it("mostra o titulo quando o texto existe", () => {
    expect(textLabel({ feature: "resumo", textTitle: "Dom Casmurro", wordsSent: 900 })).toBe(
      "Dom Casmurro"
    );
  });

  it("dicionario sem texto e uma palavra consultada", () => {
    expect(textLabel({ feature: "dicionario", textTitle: null, wordsSent: 1 })).toBe(
      "Palavra consultada"
    );
  });

  it("importacao nao tem texto ainda", () => {
    expect(textLabel({ feature: "limpeza", textTitle: null, wordsSent: 4000 })).toBe("Importação");
    expect(textLabel({ feature: "etiquetas", textTitle: null, wordsSent: 300 })).toBe(
      "Importação"
    );
  });

  it("funcao que sempre leva texto, sem texto, e texto excluido", () => {
    expect(textLabel({ feature: "explicacao", textTitle: null, wordsSent: 40 })).toBe(
      DELETED_TEXT
    );
    expect(DELETED_TEXT).toBe("Texto excluído");
  });

  it("linha anterior ao registro nao afirma exclusao", () => {
    expect(textLabel({ feature: "resumo", textTitle: null, wordsSent: 0 })).toBe(UNRECORDED_TEXT);
  });

  it("rotulos de funcao e de resultado", () => {
    expect(featureLabel("pergunta")).toBe("Pergunta ao texto");
    expect(featureLabel("nova-funcao")).toBe("nova-funcao");
    expect(outcomeLabel("sucesso")).toBe("Concluída");
    expect(outcomeLabel("tempo")).toBe("Tempo esgotado");
    expect(outcomeLabel("outro")).toBe("Falhou");
  });
});
