import { afterEach, describe, expect, it, vi } from "vitest";
import { VOICES_WAIT_MS, waitForVoices, type VoiceLike } from "@/lib/speech";

function source(initial: VoiceLike[]) {
  let voices = initial;
  const listeners = new Set<() => void>();
  return {
    getVoices: () => voices,
    addEventListener: (_: "voiceschanged", listener: () => void) => listeners.add(listener),
    removeEventListener: (_: "voiceschanged", listener: () => void) => listeners.delete(listener),
    load(next: VoiceLike[]) {
      voices = next;
      listeners.forEach((listener) => listener());
    },
    listeners,
  };
}

const ptBR: VoiceLike = { name: "Luciana", lang: "pt-BR", localService: true };

describe("narrar no primeiro toque (US-182)", () => {
  afterEach(() => vi.useRealTimers());

  it("vozes ja carregadas voltam na hora", async () => {
    expect(await waitForVoices(source([ptBR]))).toEqual([ptBR]);
  });

  it("lista vazia espera o voiceschanged", async () => {
    const voices = source([]);
    const waiting = waitForVoices(voices);
    voices.load([ptBR]);
    expect(await waiting).toEqual([ptBR]);
    expect(voices.listeners.size).toBe(0);
  });

  it("sem evento, decide depois de 2 segundos com o que houver", async () => {
    vi.useFakeTimers();
    const voices = source([]);
    const waiting = waitForVoices(voices);
    vi.advanceTimersByTime(VOICES_WAIT_MS);
    expect(await waiting).toEqual([]);
    expect(VOICES_WAIT_MS).toBe(2000);
  });
});
