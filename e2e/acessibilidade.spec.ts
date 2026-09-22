import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createText, randomIp, registerByApi } from "./helpers";


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
  await page.addInitScript(() => localStorage.setItem("rk-leitura:theme", "contrast"));
  await registerByApi(page.request);
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

test("em Sistema, o pedido de contraste do sistema aplica o alto contraste", async ({ page }) => {
  await page.emulateMedia({ contrast: "more" });
  await registerByApi(page.request);
  await page.goto("/textos");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
});
