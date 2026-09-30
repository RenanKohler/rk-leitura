import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O leitor deixou de ter os modos Foco, Rolagem e Paginas: agora abre em
 * paginas e tem o Word Runner. Texto de interface que ainda cita os modos
 * antigos manda a pessoa procurar um botao que nao existe (UX-20, APP-7).
 */

const ROOT = join(__dirname, "..", "src");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("textos de interface", () => {
  it('nao citam "modo Foco" nem "modo Rolagem"', () => {
    const offenders = tsxFiles(ROOT)
      .flatMap((path) =>
        readFileSync(path, "utf8")
          .split("\n")
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => /modos? (Foco|Rolagem)/i.test(line))
          .map(({ index }) => `${relative(ROOT, path)}:${index + 1}`)
      );

    expect(offenders).toEqual([]);
  });
});
