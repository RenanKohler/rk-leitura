import { describe, expect, it } from "vitest";
import {
  errorEntry,
  isRefCode,
  newRefCode,
  sanitizeMessage,
  sanitizeStack,
  summarizeError,
  userMessage,
} from "@/lib/error-log";

describe("codigo de referencia", () => {
  it("tem 8 caracteres sem letras ambiguas", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = newRefCode();
      expect(code).toHaveLength(8);
      expect(code).not.toMatch(/[01OI]/);
      expect(isRefCode(code)).toBe(true);
    }
  });

  it("recusa o que nao e codigo", () => {
    expect(isRefCode("abc")).toBe(false);
    expect(isRefCode("ABCDEFG0")).toBe(false);
    expect(isRefCode(12345678)).toBe(false);
  });

  it("aparece na mensagem mostrada ao leitor", () => {
    expect(userMessage("ABCD2345")).toContain("ABCD2345");
  });
});

describe("dados sensiveis fora do log", () => {
  it("apaga os parametros da consulta do Drizzle", () => {
    const message =
      'Failed query: insert into "texts" ("title","content") values ($1, $2)\nparams: Meu conto,Era uma vez';
    const clean = sanitizeMessage(message);
    expect(clean).toContain("Failed query");
    expect(clean).not.toContain("Era uma vez");
  });

  it("apaga a linha que o Postgres anexa", () => {
    const clean = sanitizeMessage(
      'null value in column "title" violates not-null constraint. Failing row contains (1, texto secreto)'
    );
    expect(clean).not.toContain("texto secreto");
  });

  it("apaga o valor duplicado e e-mails", () => {
    const clean = sanitizeMessage(
      "duplicate key value violates unique constraint. Key (lower(email))=(pessoa@exemplo.com) already exists."
    );
    expect(clean).not.toContain("pessoa@exemplo.com");
    expect(sanitizeMessage("falhou para pessoa@exemplo.com")).toBe("falhou para [e-mail]");
  });

  it("guarda so as linhas de chamada do stack", () => {
    const stack = "Error: conteudo do texto aqui\n    at foo (a.ts:1:1)\n    at bar (b.ts:2:2)";
    expect(sanitizeStack(stack)).toBe("at foo (a.ts:1:1)\nat bar (b.ts:2:2)");
  });

  it("percorre a causa, tambem sanitizada", () => {
    const cause = Object.assign(new Error("Key (email)=(a@b.com) already exists"), { code: "23505" });
    const summary = summarizeError(new Error("Failed query", { cause }));
    expect(summary.cause?.code).toBe("23505");
    expect(JSON.stringify(summary)).not.toContain("a@b.com");
  });
});

describe("linha do log", () => {
  it("tem codigo, rota, usuario e horario", () => {
    const entry = errorEntry(
      {
        ref: "ABCD2345",
        scope: "texts/post",
        source: "servidor",
        userId: "u1",
        error: { name: "Error", message: "x" },
      },
      new Date("2026-09-22T12:00:00Z")
    );
    expect(entry).toMatchObject({
      level: "error",
      ref: "ABCD2345",
      scope: "texts/post",
      userId: "u1",
      at: "2026-09-22T12:00:00.000Z",
    });
  });
});
