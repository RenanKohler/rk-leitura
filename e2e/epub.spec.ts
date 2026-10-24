import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { randomIp, registerByApi } from "./helpers";

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

/** EPUB minimo com `chapters` capitulos de 200 palavras. */
async function epub(chapters: number): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'
  );
  const items = Array.from({ length: chapters }, (_, i) => i + 1);
  zip.file(
    "OEBPS/content.opf",
    `<package><metadata><dc:title>Livro de teste</dc:title><dc:language>pt-BR</dc:language></metadata>
      <manifest>${items.map((n) => `<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest>
      <spine>${items.map((n) => `<itemref idref="c${n}"/>`).join("")}</spine></package>`
  );
  for (const n of items) {
    const body = Array.from({ length: 200 }, (_, i) => `palavra${n}x${i}`).join(" ");
    zip.file(`OEBPS/c${n}.xhtml`, `<html><body><h1>Capitulo ${n}</h1><p>${body}</p></body></html>`);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

/** US-180: o salvamento interrompido continua de onde parou, sem duplicar. */
test("salvar o livro de novo continua do capitulo que falhou", async ({ page }) => {
  await registerByApi(page.request);
  await page.goto("/textos/novo");
  await page.getByRole("radio", { name: "Arquivo" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "livro.epub",
    mimeType: "application/epub+zip",
    buffer: await epub(3),
  });
  await expect(page.getByText("3 capítulos")).toBeVisible();

  // O segundo capitulo falha uma vez.
  let posts = 0;
  await page.route("**/api/texts", async (route) => {
    if (route.request().method() === "POST" && ++posts === 2) {
      return route.fulfill({ status: 503, json: { error: "Falhou." } });
    }
    return route.fallback();
  });

  await page.getByRole("button", { name: "Importar o livro inteiro" }).click();
  await expect(page.getByText("1 de 3 capítulos salvos. Tente de novo para continuar.")).toBeVisible();

  await page.getByRole("button", { name: "Importar o livro inteiro" }).click();
  await expect(page).toHaveURL(/\/leitor\//);

  // Um envio ok, um que falhou e, na segunda vez, so os dois que faltavam:
  // o primeiro capitulo nao foi enviado de novo.
  expect(posts).toBe(4);
});
