import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers, themeBootstrapScript } from "@/components/providers";
import { OfflineProvider } from "@/components/offline-provider";
import { getSession, publicUser, sessionIsCurrent } from "@/lib/auth";
import { DEFAULT_SETTINGS, loadAccount } from "@/lib/queries";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "Leitura - leitura dinamica",
    template: "%s | Leitura",
  },
  description:
    "Importe artigos de qualquer site e leia no seu ritmo, com controle de velocidade e acompanhamento de progresso.",
  applicationName: "Leitura",
  appleWebApp: { capable: true, title: "Leitura", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Cobre a area sob a barra de gestos para que env(safe-area-inset-*) funcione.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0f11" },
  ],
};

/**
 * Sessao e preferencias sao resolvidas aqui e entregues ja no HTML.
 *
 * Antes a aplicacao subia sem saber quem era o usuario nem em que ritmo
 * renderizar: buscava as duas coisas depois de hidratar, o que custava duas
 * idas e voltas antes de qualquer conteudo util aparecer. A sessao sai do
 * proprio cookie assinado, sem consulta ao banco; so as preferencias fazem
 * uma consulta, e apenas quando ha sessao.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  // Conta apagada ou sessao revogada: o token ainda assina, mas nao vale mais.
  // A aplicacao trata como visitante ate o layout autenticado encerrar a
  // sessao (ver src/app/(app)/layout.tsx).
  const account = session ? await loadAccount(session.id) : null;
  const current = session && sessionIsCurrent(session, account?.sessionVersion ?? null);
  const settings = current ? account!.settings : null;

  return (
    <html lang="pt-BR" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Aplica o tema antes da primeira pintura, evitando o flash claro. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        <Providers
          initialUser={current ? publicUser(session) : null}
          initialSettings={settings ?? DEFAULT_SETTINGS}
        >
          <OfflineProvider>{children}</OfflineProvider>
        </Providers>
      </body>
    </html>
  );
}
