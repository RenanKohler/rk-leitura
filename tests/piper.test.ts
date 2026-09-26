import { describe, expect, it } from "vitest";
import {
  PIPER_VOICES,
  configUrl,
  findVoice,
  modelUrl,
  preferenceKey,
  voicesFor,
  wordOffsets,
} from "@/lib/piper";

describe("catalogo de vozes", () => {
  it("oferece vozes para portugues e ingles", () => {
    expect(voicesFor("pt-BR").map((voice) => voice.id)).toEqual([
      "pt_BR-faber-medium",
      "pt_BR-cadu-medium",
      "pt_BR-jeff-medium",
    ]);
    expect(voicesFor("en").length).toBe(4);
  });

  it("variantes do idioma usam as mesmas vozes", () => {
    expect(voicesFor("en-US")).toEqual(voicesFor("en"));
    expect(voicesFor("pt")).toEqual(voicesFor("pt-BR"));
  });

  it("idioma sem voz baixavel devolve lista vazia", () => {
    expect(voicesFor("es")).toEqual([]);
  });

  it("todo id e unico e so tem licenca livre", () => {
    const ids = PIPER_VOICES.map((voice) => voice.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const voice of PIPER_VOICES) {
      expect(["CC0", "Dominio publico"]).toContain(voice.license);
    }
  });

  it("monta as URLs do modelo e da configuracao", () => {
    const voice = findVoice("pt_BR-faber-medium")!;
    expect(modelUrl(voice)).toBe(
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx"
    );
    expect(configUrl(voice)).toBe(`${modelUrl(voice)}.json`);
  });

  it("id desconhecido nao encontra voz", () => {
    expect(findVoice("xx")).toBeNull();
    expect(findVoice(null)).toBeNull();
  });

  it("guarda a escolha por idioma normalizado", () => {
    expect(preferenceKey("en-US")).toBe("leitura:voz:en");
    expect(preferenceKey("pt")).toBe("leitura:voz:pt-BR");
  });
});

describe("wordOffsets", () => {
  it("a primeira palavra comeca no zero e os instantes crescem", () => {
    const offsets = wordOffsets(["O", "leitor", "ouve", "a", "frase."], 2000);
    expect(offsets[0]).toBe(0);
    for (let i = 1; i < offsets.length; i += 1) expect(offsets[i]!).toBeGreaterThan(offsets[i - 1]!);
    expect(offsets.at(-1)!).toBeLessThan(2000);
  });

  it("palavra longa ocupa mais tempo que palavra curta", () => {
    const offsets = wordOffsets(["a", "extraordinariamente", "b"], 3000);
    expect(offsets[2]! - offsets[1]!).toBeGreaterThan(offsets[1]! - offsets[0]!);
  });

  it("pontuacao conta como pausa antes da palavra seguinte", () => {
    const plain = wordOffsets(["casa", "bola", "fim"], 1000);
    const paused = wordOffsets(["casa,", "bola", "fim"], 1000);
    expect(paused[1]!).toBeGreaterThan(plain[1]!);
  });

  it("lista vazia nao quebra", () => {
    expect(wordOffsets([], 1000)).toEqual([]);
  });
});
