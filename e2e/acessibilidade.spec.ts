import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createText, randomIp, registerByApi, updateSettings } from "./helpers";


test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

/**
 * Verificacao automatizada de acessibilidade (US-75, criterio 4): nenhuma
 * violacao seria ou critica nas telas principais, nos dois temas.
 */
const SCREENS = [
  { name: "biblioteca", path: () => "/textos" },
  { name: "leitor", path: (id: string) => `/leitor/${id}` },
  { name: "estatisticas", path: () => "/estatisticas" },
  { name: "ajustes", path: () => "/ajustes" },
];

for (const scheme of ["light", "dark"] as const) {
  test(`telas principais sem violacao seria no tema ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await registerByApi(page.request);
    const text = await createText(page.request, "Texto para acessibilidade", 200);
    const blocking: { regra: string; tela: string; alvos: string[] }[] = [];

    for (const screen of SCREENS) {
      await page.goto(screen.path(text.id));
      await page.waitForLoadState("networkidle");

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      blocking.push(
        ...results.violations
          .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
          .map((violation) => ({
            regra: violation.id,
            tela: screen.name,
            alvos: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
          }))
      );
    }

    // Todas as telas antes de falhar: a lista inteira orienta a correcao.
    expect(blocking, `violacoes no tema ${scheme}`).toEqual([]);
  });
}

/** Folhas (US-75, criterio 2): o foco entra, fica preso e volta a origem. */
test("folha prende o foco e o devolve ao fechar", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Texto para foco", 200);
  await page.goto(`/leitor/${text.id}`);

  const opener = page.getByRole("button", { name: "Ajustes de leitura" });
  await opener.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Ajustes de leitura" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(":focus")).toHaveCount(1);

  for (let i = 0; i < 15; i += 1) {
    await page.keyboard.press("Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
  }
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

/**
 * Alto contraste (US-76): 7:1 nas telas principais, e aplicado sozinho quando
 * o tema esta em "Sistema" e o sistema pede contraste aumentado.
 */
test("tema de alto contraste passa na regra de 7:1", async ({ page }) => {
  // O tema vem da conta (A11Y-14); o localStorage e so cache dela.
  await registerByApi(page.request);
  await updateSettings(page.request, { theme: "contrast" });
  const text = await createText(page.request, "Texto para contraste", 200);
  const failures: { tela: string; alvos: string[] }[] = [];

  for (const screen of SCREENS) {
    await page.goto(screen.path(text.id));
    await page.waitForLoadState("networkidle");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");

    const results = await new AxeBuilder({ page }).withRules(["color-contrast-enhanced"]).analyze();
    for (const violation of results.violations) {
      failures.push({
        tela: screen.name,
        alvos: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
      });
    }
  }

  expect(failures).toEqual([]);
});

/** A11Y-14: o tema salvo na conta vale em outro aparelho, com cache local vazio. */
test("tema salvo na conta e aplicado em outro aparelho", async ({ page, browser }) => {
  const email = await registerByApi(page.request);
  await updateSettings(page.request, { theme: "dark" });

  const other = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
    colorScheme: "light",
  });
  const login = await other.request.post("/api/auth/login", {
    data: { email, password: "senha-e2e-123" },
  });
  expect(login.ok()).toBeTruthy();
  const otherPage = await other.newPage();
  await otherPage.goto("/textos");
  await expect(otherPage.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await otherPage.evaluate(() => localStorage.getItem("rk-leitura:theme"))).toBe("dark");
  await other.close();
});

/** Pular para o conteudo (A11Y-15): primeiro Tab da tela leva ao main. */
test("link de pular para o conteudo", async ({ page }) => {
  await registerByApi(page.request);
  await page.goto("/textos");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Pular para o conteúdo" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#conteudo")).toBeFocused();
  await expect(page).toHaveTitle(/Textos/);
});

/** A11Y-17: nada estoura a largura da tela em 320px. */
test("telas cabem em 320px sem rolagem horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await registerByApi(page.request);
  await page.request.post("/api/etiquetas", { data: { name: "etiqueta comprida de teste" } });

  for (const path of ["/textos", "/ajustes", "/voce", "/textos/novo"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `rolagem horizontal em ${path}`).toBeLessThanOrEqual(0);
  }
});

/** A11Y-8: controle segmentado e um radiogroup com setas. */
test("controle segmentado anda pelas setas", async ({ page }) => {
  await registerByApi(page.request);
  await page.goto("/textos/novo");
  const group = page.getByRole("radiogroup", { name: "Origem do texto" });
  await expect(group).toBeVisible();

  const link = group.getByRole("radio", { name: "Link" });
  await expect(link).toHaveAttribute("aria-checked", "true");
  await link.focus();
  await page.keyboard.press("ArrowRight");
  const paste = group.getByRole("radio", { name: "Colar" });
  await expect(paste).toBeFocused();
  await expect(paste).toHaveAttribute("aria-checked", "true");
  // Uma parada de Tab so para o grupo.
  await expect(group.locator('[tabindex="0"]')).toHaveCount(1);
});

/** A11Y-13: a folha de navegacao abre com o foco na busca. */
test("folha de navegacao foca o campo de busca", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Texto para buscar", 200);
  await page.goto(`/leitor/${text.id}`);
  await page.getByRole("button", { name: "Navegar no texto" }).click();
  await expect(page.getByRole("searchbox", { name: "Buscar no texto" })).toBeFocused();
});

test("em Sistema, o pedido de contraste do sistema aplica o alto contraste", async ({ page }) => {
  await page.emulateMedia({ contrast: "more" });
  await registerByApi(page.request);
  await page.goto("/textos");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
});
