import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logError } from "@/lib/error-log";

/** Erro como o Drizzle monta: consulta, `params` e a causa do driver. */
function drizzleError() {
  const cause = Object.assign(new Error('duplicate key value violates unique constraint\nFailing row contains (leitor@exemplo.com, segredo)'), {
    code: "23505",
  });
  return new Error(
    'Failed query: insert into "rate_limits" ("key") values ($1)\nparams: login-conta:leitor@exemplo.com,Qual o sentido do capitulo?',
    { cause }
  );
}

describe("logs sem dados pessoais nem conteudo (US-187)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("o erro do banco sai resumido, sem params, e-mail nem a pergunta", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logError("rate-limit/indisponivel-liberando", drizzleError());
    const line = spy.mock.calls.flat().map(String).join(" ");
    expect(line).toContain("[rate-limit/indisponivel-liberando]");
    expect(line).toContain("params: [omitidos]");
    expect(line).not.toContain("leitor@exemplo.com");
    expect(line).not.toContain("Qual o sentido");
    expect(line).not.toContain("segredo");
  });

  it("os tres pontos da evidencia usam logError", () => {
    for (const file of ["src/lib/rate-limit.ts", "src/app/api/texts/[id]/pergunta/route.ts", "src/lib/ai.ts"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).toContain("logError(");
      expect(source).not.toMatch(/console\.error\([^)]*\berror\)/);
    }
  });
});
