import { ImportError, importReceivedPages } from "@/lib/import-text";
import { MAX_SENT_CHARS, MAX_SENT_PAGES, RECEIVED_KEY } from "@/lib/bookmarklet";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { normalizeSourceUrl } from "@/lib/source-url";

export const dynamic = "force-dynamic";

/**
 * Recebe as paginas enviadas pelo favorito "Enviar para o Leitura".
 *
 * O envio e um formulario de outro site: o cookie de sessao (SameSite=Lax)
 * nao vem num POST entre sites, entao a rota nao exige sessao. Ela nao busca
 * nada na rede nem grava nada: so extrai o texto do HTML recebido e devolve
 * uma pagina que passa o resultado para "Novo texto" pelo sessionStorage da
 * aba. Salvar continua exigindo sessao e a confirmacao da pessoa na previa.
 */
export async function POST(request: Request) {
  const limit = await rateLimit(`receber:${clientIp(request)}`, 20, 10 * 60 * 1000);
  if (!limit.allowed) return handoff({ error: "Muitos envios seguidos. Aguarde um pouco." });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return handoff({ error: "Não consegui ler o envio da página." });
  }

  const url = normalizeSourceUrl(String(form.get("url") ?? ""));
  if (!/^https?:\/\//i.test(url)) return handoff({ error: "O envio veio sem o endereço da página." });

  const pages = form
    .getAll("html")
    .filter((value): value is string => typeof value === "string")
    .slice(0, MAX_SENT_PAGES);
  const size = pages.reduce((total, html) => total + html.length, 0);
  if (pages.length === 0) return handoff({ error: "O envio veio sem o conteúdo da página." });
  // Folga sobre o teto do favorito: a quebra de linha vira CRLF no envio.
  if (size > MAX_SENT_CHARS * 1.2) return handoff({ error: "A página enviada é grande demais." });

  try {
    const imported = await importReceivedPages(url, pages, form.get("parcial") === "1");
    return handoff({ imported });
  } catch (error) {
    if (error instanceof ImportError) return handoff({ error: error.message });
    console.error("[receber] falha ao extrair o texto enviado:", error);
    return handoff({ error: "Não consegui extrair o texto da página enviada." });
  }
}

/**
 * Pagina de passagem: guarda o resultado na aba e abre "Novo texto". O JSON
 * vai num bloco de dados com `<` escapado, para o conteudo da pagina de
 * origem nunca fechar o script nem virar HTML.
 */
function handoff(payload: { imported?: unknown; error?: string }): Response {
  const data = JSON.stringify(payload)
    .replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Enviando para o Leitura</title></head>
<body style="font:16px sans-serif;padding:24px">
<p>Abrindo o Leitura...</p>
<script type="application/json" id="recebido">${data}</script>
<script>
try { sessionStorage.setItem(${JSON.stringify(RECEIVED_KEY)}, document.getElementById("recebido").textContent); } catch (e) {}
location.replace("/textos/novo?recebido=1");
</script>
</body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
