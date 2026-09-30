"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/components/providers";
import {
  HomeIcon,
  LibraryIcon,
  LogoMark,
  LogoutIcon,
  PlusIcon,
  SettingsIcon,
  UserIcon,
} from "@/components/icons";

/**
 * Destinos principais (APP-6).
 *
 * "Voce" entrou no lugar de "Historico": Estatisticas, Palavras e revisao e
 * Treino so eram alcancaveis de dentro de Ajustes, e ninguem procura o
 * proprio progresso na tela de preferencias. O hub junta essas telas e o
 * historico; `also` lista as rotas que acendem a aba mesmo fora do caminho
 * dela.
 */
const NAV = [
  { href: "/dashboard", label: "Inicio", Icon: HomeIcon, also: [] },
  { href: "/textos", label: "Textos", Icon: LibraryIcon, also: [] },
  {
    href: "/voce",
    label: "Voce",
    Icon: UserIcon,
    also: ["/historico", "/estatisticas", "/palavras", "/treino"],
  },
  { href: "/ajustes", label: "Ajustes", Icon: SettingsIcon, also: [] },
] as const;

type NavItem = (typeof NAV)[number];

/**
 * Titulo da aba para rotas que ainda nao exportam `metadata` (A11Y-15).
 *
 * Cada rota deveria declarar o proprio titulo; estas pertencem a telas em
 * reescrita e continuam so com o titulo generico do app, que o leitor de tela
 * anuncia igual em toda navegacao. Ate elas ganharem `metadata`, o titulo
 * vem daqui. A primeira correspondencia vence, entao a rota mais especifica
 * vem antes.
 */
const FALLBACK_TITLES: [prefix: string, title: string][] = [
  ["/palavras/revisar", "Revisao de palavras"],
  ["/palavras", "Palavras"],
  ["/estatisticas", "Estatisticas"],
  ["/treino", "Treino"],
];

function useFallbackTitle(pathname: string) {
  useEffect(() => {
    const found = FALLBACK_TITLES.find(([prefix]) => matches(pathname, prefix));
    if (!found) return;
    const wanted = `${found[1]} | Leitura`;
    const apply = () => {
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    // O Next escreve o titulo padrao ao terminar a navegacao, as vezes depois
    // deste efeito; o observador reaplica enquanto a rota for esta.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [pathname]);
}

function matches(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isActive(pathname: string, item: NavItem) {
  return matches(pathname, item.href) || item.also.some((href) => matches(pathname, href));
}

/**
 * Estrutura de navegacao.
 *
 * Celular: barra inferior fixa, ao alcance do polegar, com o botao de importar
 * no centro. Desktop (>=lg): coluna lateral e a barra inferior some.
 * O leitor renderiza sem nenhuma das duas para nao competir com o texto.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const immersive = pathname.startsWith("/leitor/");
  useFallbackTitle(pathname);

  if (immersive) return <>{children}</>;

  return (
    <div className="min-h-dvh">
      {/* Primeira parada de Tab (A11Y-15): sem ele, quem navega por teclado
          atravessa a navegacao inteira em toda tela antes do conteudo. */}
      <a
        href="#conteudo"
        className="sr-only rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70]"
      >
        Pular para o conteudo
      </a>

      <DesktopSidebar pathname={pathname} name={user?.name} email={user?.email} onLogout={logout} />

      <div className="lg:pl-64">
        <main
          id="conteudo"
          // Alvo do link acima: sem tabIndex o foco nao chega ao main.
          tabIndex={-1}
          className="mx-auto w-full max-w-3xl px-4 pt-4 pb-28 focus:outline-none sm:px-6 lg:pb-10"
        >
          {children}
        </main>
      </div>

      <MobileTabBar pathname={pathname} />
    </div>
  );
}

function DesktopSidebar({
  pathname,
  name,
  email,
  onLogout,
}: {
  pathname: string;
  name?: string;
  email?: string;
  onLogout: () => void;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex items-center gap-2.5 px-5 py-6">
        <LogoMark className="size-8 text-accent" />
        <span className="text-lg font-semibold tracking-tight">Leitura</span>
      </div>

      <nav aria-label="Navegacao principal" className="flex-1 space-y-1 px-3">
        {NAV.map((item) => {
          const { href, label, Icon } = item;
          const active = isActive(pathname, item);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
                active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          );
        })}

        <Link
          href="/textos/novo"
          className="mt-3 flex min-h-11 items-center gap-3 rounded-xl bg-accent px-3 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover"
        >
          <PlusIcon className="size-5" />
          Novo texto
        </Link>
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
            {name?.charAt(0).toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{name ?? "Carregando"}</p>
            <p className="truncate text-xs text-faint">{email ?? ""}</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sair"
            title="Sair"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
          >
            <LogoutIcon className="size-5" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function MobileTabBar({ pathname }: { pathname: string }) {
  const [first, second, third, fourth] = NAV;

  return (
    <nav
      aria-label="Navegacao principal"
      // Marca para os avisos flutuantes subirem acima da barra (globals.css).
      data-tabbar=""
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-lg lg:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 items-center px-1">
        <TabLink {...first} active={isActive(pathname, first)} />
        <TabLink {...second} active={isActive(pathname, second)} />

        <div className="flex justify-center">
          <Link
            href="/textos/novo"
            aria-label="Importar novo texto"
            className="-mt-5 flex size-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-float transition-transform active:scale-95"
          >
            <PlusIcon className="size-6" strokeWidth={2.2} />
          </Link>
        </div>

        <TabLink {...third} active={isActive(pathname, third)} />
        <TabLink {...fourth} active={isActive(pathname, fourth)} />
      </div>
    </nav>
  );
}

function TabLink({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
        active ? "text-accent" : "text-muted"
      }`}
    >
      <Icon className="size-6" />
      {label}
    </Link>
  );
}
