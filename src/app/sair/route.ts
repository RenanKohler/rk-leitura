import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Encerra a sessao e volta ao login.
 *
 * Existe por um motivo estreito: um componente de servidor nao pode apagar
 * cookie durante a renderizacao, entao o layout autenticado, ao descobrir que
 * a conta nao existe mais ou que a sessao foi revogada, precisa de um lugar
 * para onde redirecionar. Sem isso o redirecionamento entraria em laco - o
 * middleware manda quem tem token valido de volta para o painel.
 *
 * Responde uma pagina minima, e nao um redirecionamento direto, porque quem
 * chega aqui pode ser outro aparelho cuja sessao foi encerrada por "sair de
 * todos os aparelhos" (US-63): o cache offline dele guarda o HTML do leitor,
 * com os textos dentro, e precisa ser apagado como numa saida comum.
 *
 * Metodo GET porque o destino e uma navegacao. O unico efeito possivel de
 * alguem disparar isto de fora e encerrar a propria sessao de quem clicou, o
 * que e o que a rota faz de qualquer forma.
 */
export async function GET() {
  await clearSession();

  return new NextResponse(PAGE, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Destino relativo: atras de um proxy, remontar o host a partir da requisicao
// mandaria o usuario para o host errado. O tempo limite garante a saida mesmo
// sem service worker, ou com um que nao responda.
const PAGE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="3;url=/login">
<title>Saindo</title>
</head>
<body>
<p>Saindo da conta...</p>
<script>
(function () {
  var done = false;
  function go() { if (!done) { done = true; location.replace("/login"); } }
  setTimeout(go, 1500);
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "limpar" });
    }
    if (window.caches) {
      caches.keys()
        .then(function (keys) {
          // As vozes baixadas nao guardam nada da conta: ficam para a proxima.
          return Promise.all(keys.filter(function (k) { return k !== "leitura-vozes"; })
            .map(function (k) { return caches.delete(k); }));
        })
        .then(go, go);
    } else {
      go();
    }
  } catch (e) {
    go();
  }
})();
</script>
</body>
</html>`;
