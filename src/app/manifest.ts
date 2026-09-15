import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Leitura - leitura dinamica",
    short_name: "Leitura",
    description: "Importe artigos e leia no seu ritmo.",
    start_url: "/dashboard",
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
  };
}
