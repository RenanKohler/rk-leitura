import { describe, expect, it } from "vitest";
import { BACKUP_KIND, batchesOf, MAX_BACKUP_TEXTS, parseBackup, UNRECOGNIZED } from "@/lib/backup";

const text = { titulo: "A", conteudo: "uma frase curta", formato: "plain" as const };

describe("parseBackup (US-98)", () => {
  it("aceita o envelope da versao 2", () => {
    const result = parseBackup({ formato: BACKUP_KIND, versao: 2, textos: [text] });
    expect(result.ok && result.texts).toHaveLength(1);
  });

  it("aceita a versao 3 com autor, serie, largado, secoes e o bloco da conta (US-189)", () => {
    const result = parseBackup({
      formato: BACKUP_KIND,
      versao: 3,
      textos: [
        {
          ...text,
          id: "5f0c0e1e-0000-4000-8000-000000000000",
          autor: "Machado de Assis",
          serie: { chave: "exemplo.com/serie", titulo: "Serie", capitulo: 4 },
          largadoEm: "2026-10-01T12:00:00.000Z",
          palavrasRestantes: 120,
          secoes: [{ index: 0, title: "Abertura" }],
        },
      ],
      conta: { perfil: { nome: "Ana" }, tabelas: { reading_sessions: [] } },
    });
    expect(result.ok).toBe(true);
    const restored = result.ok ? result.texts[0]! : null;
    expect(restored?.autor).toBe("Machado de Assis");
    expect(restored?.serie?.capitulo).toBe(4);
    expect(restored?.largadoEm).toBe("2026-10-01T12:00:00.000Z");
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
