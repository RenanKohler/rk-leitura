import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearLocalPositions,
  localPositionKey,
  OFFLINE_TEXTS,
  openingPosition,
  otherDeviceMessage,
  otherDevicePosition,
  parseLocalPosition,
  QUEUEABLE,
  serviceWorkerUrl,
} from "@/lib/offline";

const sw = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");

describe("reabrir offline na ultima posicao (US-173)", () => {
  const server = { progressIndex: 1000, updatedAt: "2026-10-20T10:00:00Z", wordCount: 8000 };

  it("a posicao do aparelho, mais recente, vale sobre a do HTML", () => {
    const local = { progressIndex: 6000, at: "2026-10-20T12:00:00Z", words: 8000 };
    expect(openingPosition(server, local)).toBe(6000);
  });

  it("a do HTML vale quando e mais recente ou o texto mudou", () => {
    expect(openingPosition(server, { progressIndex: 6000, at: "2026-10-20T09:00:00Z", words: 8000 })).toBeNull();
    expect(openingPosition(server, { progressIndex: 6000, at: "2026-10-20T12:00:00Z", words: 7999 })).toBeNull();
    expect(openingPosition(server, null)).toBeNull();
  });

  it("a chave leva a conta: outra conta nao le a posicao da anterior", () => {
    expect(localPositionKey("a", "t")).not.toBe(localPositionKey("b", "t"));
  });

  it("le so o que tem forma de posicao", () => {
    expect(parseLocalPosition('{"progressIndex":3,"at":"2026-10-20T12:00:00Z","words":9}')).toEqual({
      progressIndex: 3,
      at: "2026-10-20T12:00:00Z",
      words: 9,
    });
    expect(parseLocalPosition("{")).toBeNull();
    expect(parseLocalPosition('{"progressIndex":"3"}')).toBeNull();
  });

  it("sair da conta apaga as posicoes e deixa o resto", () => {
    const items = new Map([
      [localPositionKey("a", "t1"), "x"],
      [localPositionKey("b", "t2"), "y"],
      ["leitura-tema", "escuro"],
    ]);
    const storage = {
      get length() {
        return items.size;
      },
      key: (i: number) => [...items.keys()][i] ?? null,
      removeItem: (key: string) => void items.delete(key),
    };
    clearLocalPositions(storage);
    expect([...items.keys()]).toEqual(["leitura-tema"]);
  });
});

describe("continuar de onde parei em outro aparelho (US-174)", () => {
  const tab = { known: 1000, current: 1000, words: 8000 };

  it("posicao gravada por outro aparelho pede confirmacao", () => {
    expect(otherDevicePosition({ progressIndex: 5000, wordCount: 8000 }, tab)).toBe(5000);
    expect(otherDeviceMessage(5000)).toBe(
      "Você leu até a palavra 5.000 em outro aparelho. Continuar de lá?"
    );
  });

  it("a propria gravacao, ou a posicao em que a aba ja esta, nao pergunta", () => {
    expect(otherDevicePosition({ progressIndex: 1000, wordCount: 8000 }, tab)).toBeNull();
    expect(otherDevicePosition({ progressIndex: 1200, wordCount: 8000 }, { ...tab, current: 1200 })).toBeNull();
  });

  it("texto editado em outra aba recarrega", () => {
    expect(otherDevicePosition({ progressIndex: 0, wordCount: 7000 }, tab)).toBe("recarregar");
  });
});

describe("cache offline por versao (US-176)", () => {
  it("o endereco do worker leva o build", () => {
    expect(serviceWorkerUrl("abc123")).toBe("/sw.js?v=abc123");
    expect(serviceWorkerUrl(undefined)).toBe("/sw.js?v=dev");
    expect(sw).toContain('new URL(self.location.href).searchParams.get("v")');
  });

  it("limite de textos e rotas enfileiraveis batem com o sw.js", () => {
    expect(Number(sw.match(/const OFFLINE_TEXTS = (\d+);/)?.[1])).toBe(OFFLINE_TEXTS);
    const queueable = sw.match(/const QUEUEABLE = (\[.*\]);/)?.[1];
    expect(queueable).toBe(`[${QUEUEABLE.map(String).join(", ")}]`);
  });
});
