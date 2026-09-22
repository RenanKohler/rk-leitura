import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** E-mail unico por teste: a suite roda contra um banco que nao e zerado. */
export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@exemplo.com`;
}

/** Texto de exemplo com a quantidade pedida de palavras, em paragrafos de 60. */
export function sampleText(words: number): string {
  const vocabulary =
    "leitura rapida exige atencao constante ao ritmo das frases e ao sentido do texto".split(" ");
  const all = Array.from({ length: words }, (_, i) => {
    const word = vocabulary[i % vocabulary.length]!;
    return (i + 1) % 12 === 0 ? `${word}.` : word;
  });
  const paragraphs: string[] = [];
  for (let i = 0; i < all.length; i += 60) paragraphs.push(all.slice(i, i + 60).join(" "));
  return paragraphs.join("\n\n");
}

/** Cria a conta pela API; o cookie fica no contexto da pagina. */
export async function registerByApi(request: APIRequestContext, name = "Leitor E2E") {
  const email = uniqueEmail();
  const response = await request.post("/api/auth/register", {
    data: { name, email, password: "senha-e2e-123" },
  });
  expect(response.ok()).toBeTruthy();
  return email;
}

/** Ajusta as preferencias partindo das atuais: o PUT substitui tudo. */
export async function updateSettings(request: APIRequestContext, changes: Record<string, unknown>) {
  const current = await (await request.get("/api/settings")).json();
  const response = await request.put("/api/settings", {
    data: { ...current.settings, ...changes },
  });
  expect(response.ok()).toBeTruthy();
}

export async function createText(request: APIRequestContext, title: string, words: number) {
  const response = await request.post("/api/texts", {
    data: { title, content: sampleText(words) },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).text as { id: string; wordCount: number };
}

export async function progressOf(request: APIRequestContext, id: string): Promise<number> {
  const response = await request.get(`/api/texts/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).text.progressIndex as number;
}

/** Espera o leitor terminar de hidratar: o botao de iniciar so responde depois. */
export async function openReader(page: Page, id: string) {
  await page.goto(`/leitor/${id}`);
  await expect(page.getByRole("button", { name: "Iniciar leitura" })).toBeVisible();
}

/**
 * Endereco de origem proprio para cada teste.
 *
 * O cadastro aceita 5 contas por hora por IP, e a suite cria uma conta por
 * teste. Em vez de afrouxar o limite no codigo, cada teste se apresenta com
 * um IP diferente no cabecalho que o limitador le.
 */
export function randomIp(): string {
  const part = () => Math.floor(Math.random() * 250) + 1;
  return `10.${part()}.${part()}.${part()}`;
}
