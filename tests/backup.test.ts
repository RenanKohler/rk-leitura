import { describe, expect, it } from "vitest";
import { BACKUP_KIND, batchesOf, MAX_BACKUP_TEXTS, parseBackup, UNRECOGNIZED } from "@/lib/backup";

const text = { titulo: "A", conteudo: "uma frase curta", formato: "plain" as const };

describe("parseBackup (US-98)", () => {
  it("aceita o envelope da versao 2", () => {
    const result = parseBackup({ formato: BACKUP_KIND, versao: 2, textos: [text] });
    expect(result.ok && result.texts).toHaveLength(1);
  });

  it("aceita a lista solta da versao 1", () => {
    const result = parseBackup([{ ...text, destaques: [{ inicio: 0, fim: 2, nota: null }] }]);
    expect(result.ok).toBe(true);
  });

  it("recusa arquivo de outro formato", () => {
    expect(parseBackup({ foo: 1 })).toEqual({ ok: false, error: UNRECOGNIZED });
    expect(parseBackup([{ titulo: "sem conteudo" }])).toEqual({ ok: false, error: UNRECOGNIZED });
    expect(parseBackup("texto")).toEqual({ ok: false, error: UNRECOGNIZED });
  });

  it("recusa mais textos que o limite", () => {
    const many = Array.from({ length: MAX_BACKUP_TEXTS + 1 }, () => text);
    const result = parseBackup(many);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(String(MAX_BACKUP_TEXTS));
  });
});

describe("batchesOf", () => {
  it("separa em lotes de no maximo 100 textos", () => {
    const batches = batchesOf(Array.from({ length: 250 }, () => text));
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
  });

  it("textos grandes dividem o lote pelo tamanho", () => {
    const big = { ...text, conteudo: "x".repeat(399_000) };
    const batches = batchesOf([big, big, big, big, big]);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toHaveLength(5);
    for (const batch of batches) expect(JSON.stringify(batch).length * 2).toBeLessThanOrEqual(3 * 1024 * 1024 + 2_000);
  });
});
