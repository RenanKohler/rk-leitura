import { defineConfig, devices } from "@playwright/test";

/**
 * Testes no navegador do fluxo principal (US-74) e de acessibilidade (US-75).
 *
 * Rodam contra a aplicacao de verdade, com banco: na CI, o build de producao
 * ligado a um Postgres de servico; localmente, o servidor de desenvolvimento
 * que ja estiver no ar na porta, ou um novo. Nada depende de rede externa.
 *
 * `PW_CHROMIUM_PATH` aponta para um Chromium ja instalado quando nao se quer
 * baixar o do Playwright (ambientes sem acesso ao repositorio de navegadores).
 */
const PORT = Number(process.env.E2E_PORT ?? 3200);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Pixel 7"],
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: {
    command: process.env.CI ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
