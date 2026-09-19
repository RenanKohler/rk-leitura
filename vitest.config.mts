import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Os testes cobrem as regras puras: extracao, classificacao de endereco,
 * normalizacao de URL, continuacao e as contas de leitura. Nada que dependa de
 * rede ou banco entra aqui - o que precisa deles e verificado contra o deploy.
 */
export default defineConfig({
  resolve: {
    alias: {
      // Mesmo apelido do tsconfig.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` existe para o bundler do Next recusar esses modulos no
      // cliente. Fora dele o pacote lanca ao ser importado, entao aqui ele
      // vira um modulo vazio.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
