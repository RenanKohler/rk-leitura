import { afterEach, describe, expect, it, vi } from "vitest";
import { addPendingMark, isPendingMark } from "@/lib/highlights";
import { queueable } from "@/lib/offline";
import { apiGet, apiSend, ApiError, NO_CONNECTION } from "@/lib/client";
import type { HighlightItem } from "@/lib/types";

/** Destacar sem conexao (US-177). */

const TEXT = "11111111-2222-3333-4444-555555555555";
const MARK = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const words = "um dois tres quatro cinco seis sete oito nove dez".split(" ");

const mark = (id: string, start: number, end: number, note: string | null = null): HighlightItem => ({
  id,
  start,
  end,
  note,
  excerpt: words.slice(start, end).join(" "),
  createdAt: "2026-10-24T10:00:00.000Z",
});

describe("fila offline dos destaques", () => {
  it("criar destaque e mudar a nota podem esperar a conexao", () => {
    expect(queueable(`/api/texts/${TEXT}/destaques`, "POST")).toBe(true);
    expect(queueable(`/api/texts/${TEXT}/destaques/${MARK}`, "PATCH")).toBe(true);
  });

  it("apagar e as rotas de IA dos destaques nao entram na fila", () => {
    expect(queueable(`/api/texts/${TEXT}/destaques/${MARK}`, "DELETE")).toBe(false);
    expect(queueable(`/api/texts/${TEXT}/destaques/cartoes`, "POST")).toBe(false);
    expect(queueable(`/api/texts/${TEXT}/destaques/sintese`, "POST")).toBe(false);
  });
});

describe("destaque pendente na tela", () => {
  it("aparece com o trecho e um id de pendente", () => {
    const result = addPendingMark([], { start: 2, end: 4 }, words);
    expect(result).toHaveLength(1);
    expect(isPendingMark(result[0]!.id)).toBe(true);
    expect(result[0]!.excerpt).toBe("tres quatro");
  });

  it("funde com o que encosta, guardando a nota, como o servidor fara", () => {
    const result = addPendingMark([mark("a", 0, 3, "nota"), mark("b", 7, 9)], { start: 3, end: 5 }, words);
    expect(result.map((item) => [item.start, item.end])).toEqual([
      [0, 5],
      [7, 9],
    ]);
    expect(result[0]!.note).toBe("nota");
    expect(isPendingMark(result[0]!.id)).toBe(true);
  });
});

describe("falha de rede no cliente", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("vira a mensagem em portugues, nunca 'Failed to fetch'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(apiSend("/api/x", "POST", {})).rejects.toMatchObject({ message: NO_CONNECTION });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Load failed")));
    const failure = await apiGet("/api/x").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toBe(NO_CONNECTION);
  });

  it("cancelamento passa como veio", async () => {
    const abort = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(apiGet("/api/x")).rejects.toBe(abort);
  });
});
