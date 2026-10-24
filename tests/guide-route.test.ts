import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseParagraphs } from "@/lib/reading";
import { guideAllowed } from "@/lib/guide-questions";
import { sectionRanges } from "@/lib/text-sections";
import { textHeadings } from "@/lib/navigation";

// Texto com 9 secoes de 10 palavras cada, sem rede nem banco.
const content = Array.from(
  { length: 9 },
  (_, n) => `# Parte ${n + 1}\n\n${Array.from({ length: 10 }, (_, w) => `palavra${n}x${w}`).join(" ")}.`
).join("\n\n");
const parsed = parseParagraphs(content, "markdown");
const sections = sectionRanges(textHeadings(parsed.paragraphs), parsed.words.length);
let progressIndex = 0;

const generate = vi.fn(async () => ({ questions: [] }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  requireSession: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "1.1.1.1",
  rateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
}));
vi.mock("@/lib/ai-results", () => ({
  loadAiResult: async () => null,
  saveAiResult: async () => undefined,
}));
vi.mock("@/lib/study-ai", () => ({
  generateGuide: (...args: unknown[]) => generate(...(args as [])),
  GUIDE_MESSAGES: { failure: "Falhou." },
}));
vi.mock("@/lib/study-tools", async () => {
  const { matchKeys } = await import("@/lib/passage-match");
  return {
    loadStudyText: async () => ({
      id: "t1",
      title: "T",
      language: "pt",
      words: parsed.words,
      paragraphs: parsed.paragraphs,
      progressIndex,
      fingerprint: "f",
      sections: null,
    }),
    sectionsOf: () => sections,
    keysOf: () => matchKeys(parsed.words),
    studyGate: async () => null,
  };
});

const { POST } = await import("@/app/api/texts/[id]/guia/route");

function ask(section: number) {
  return POST(
    new Request("http://local/api/texts/t1/guia", {
      method: "POST",
      body: JSON.stringify({ section }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: "t1" }) }
  );
}

describe("perguntas-guia sem spoiler no servidor (US-194)", () => {
  beforeEach(() => generate.mockClear());

  it("aceita a secao atual e a seguinte", () => {
    const atSection2 = sections[1]!.start + 2;
    expect(guideAllowed(sections, sections[1]!.start, atSection2)).toBe(true);
    expect(guideAllowed(sections, sections[2]!.start, atSection2)).toBe(true);
    expect(guideAllowed(sections, sections[0]!.start, atSection2)).toBe(true);
    expect(guideAllowed(sections, sections[7]!.start, atSection2)).toBe(false);
  });

  it("antes da primeira secao, so a primeira", () => {
    expect(guideAllowed(sections, sections[0]!.start, 0)).toBe(true);
    expect(guideAllowed(sections, sections[1]!.start, 0)).toBe(sections[0]!.start === 0);
  });

  it("pedido da secao 8 lendo a 2 responde 403 e nada vai a IA", async () => {
    progressIndex = sections[1]!.start + 2;
    const response = await ask(sections[7]!.start);
    expect(response.status).toBe(403);
    expect(generate).not.toHaveBeenCalled();
  });

  it("pedido da secao 3 lendo a 2 chega a IA", async () => {
    progressIndex = sections[1]!.start + 2;
    await ask(sections[2]!.start);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
