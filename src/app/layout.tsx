import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Roboto_Flex } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { serverTheme, themeBootstrapScript } from "@/lib/theme";
import { OfflineProvider } from "@/components/offline-provider";
import { getSession, publicUser, sessionIsCurrent } from "@/lib/auth";
import { DEFAULT_SETTINGS, loadAccount } from "@/lib/queries";

// Fonte do design system (M3): Roboto Flex, nos pesos 400 e 500 da escala.
const robotoFlex = Roboto_Flex({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-roboto-flex",
});

export const metadata: Metadata = {
  title: {
    default: "Leitura - leitura dinâmica",
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
    // `surface` do esquema M3 claro e escuro (globals.css).
    { media: "(prefers-color-scheme: light)", color: "#f5fbf5" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1512" },
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
  const account = session ? await loadAccount(session.id, session.sid) : null;
  const current = session && sessionIsCurrent(session, account?.sessionVersion ?? null);
  const settings = current ? account!.settings : null;

  // Tema da conta (A11Y-14): escolha explicita ja sai no HTML; "Sistema" e
  // resolvido pelo script, que tambem guarda a escolha como cache local.
  const accountTheme = settings?.theme ?? null;

  return (
    <html
      lang="pt-BR"
      className={robotoFlex.variable}
      data-theme={serverTheme(accountTheme)}
      suppressHydrationWarning
    >
      <head>
        {/* Aplica o tema antes da primeira pintura, evitando o flash claro. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript(accountTheme) }} />
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
