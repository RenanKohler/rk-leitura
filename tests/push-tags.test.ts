import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PUSH_TAG, PUSH_TAGS } from "@/lib/push-tags";

const sw = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");

describe("tags das notificacoes (US-201)", () => {
  it("leitura e revisao tem tags diferentes", () => {
    expect(PUSH_TAGS.leitura).toBe("lembrete-leitura");
    expect(PUSH_TAGS.revisao).toBe("lembrete-revisao");
    expect(new Set(Object.values(PUSH_TAGS)).size).toBe(Object.values(PUSH_TAGS).length);
  });

  it("o service worker usa a tag do payload e cai na antiga sem ela", () => {
    expect(sw).toContain(`tag: payload.tag ?? "${DEFAULT_PUSH_TAG}"`);
  });
});
