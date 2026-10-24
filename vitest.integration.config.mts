import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Testes de integracao (US-207): rodam contra um Postgres de verdade, com as
 * migrations aplicadas - na CI, o mesmo banco do job do navegador. Ficam fora
 * do `npm test` porque precisam de DATABASE_URL.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Um arquivo por vez: todos usam o mesmo banco.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
