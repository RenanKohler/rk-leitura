import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Leitura - leitura dinamica",
    short_name: "Leitura",
    description: "Importe artigos e leia no seu ritmo.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0e0f11",
    theme_color: "#0e0f11",
    lang: "pt-BR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Coloca o app na lista de compartilhamento do sistema. Com ele instalado,
    // o caminho deixa de ser "copiar o endereco, abrir o app, colar": basta
    // tocar em Compartilhar no navegador e escolher Leitura.
    //
    // O metodo e GET porque POST exigiria um service worker para interceptar a
    // requisicao. O que chega na URL e so o pedido; a importacao acontece
    // depois, em uma chamada propria (ver src/app/(app)/compartilhar).
    share_target: {
      action: "/compartilhar",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
