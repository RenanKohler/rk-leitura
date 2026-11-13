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
  { href: "/dashboard", label: "Início", Icon: HomeIcon, also: [] },
  { href: "/textos", label: "Textos", Icon: LibraryIcon, also: [] },
  {
    href: "/voce",
    label: "Você",
    Icon: UserIcon,
    also: ["/historico", "/estatisticas", "/palavras", "/treino", "/revisar"],
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
  ["/palavras/revisar", "Revisão de palavras"],
  ["/palavras", "Palavras"],
  ["/estatisticas", "Estatísticas"],
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
        Pular para o conteúdo
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
    // Gaveta de navegacao do M3: surface-container-low, sem divisor lateral.
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-surface-container-low lg:flex">
      <div className="flex items-center gap-2.5 px-7 py-6">
        <LogoMark className="size-8 text-primary" />
        <span className="text-title-large">Leitura</span>
      </div>

      <nav aria-label="Navegação principal" className="flex-1 space-y-1 px-3">
        {NAV.map((item) => {
          const { href, label, Icon } = item;
          const active = isActive(pathname, item);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`state-layer flex min-h-14 items-center gap-3 rounded-full px-4 text-sm font-medium tracking-[0.1px] transition-colors ${
                active
                  ? "bg-secondary-container text-on-secondary-container"
                  : "text-on-surface-variant"
              }`}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          );
        })}

        <Link
          href="/textos/novo"
          // FAB estendido do M3.
          className="state-layer mt-3 flex min-h-14 items-center gap-3 rounded-2xl bg-primary-container px-4 text-sm font-medium tracking-[0.1px] text-on-primary-container"
        >
          <PlusIcon className="size-5" />
          Novo texto
        </Link>
      </nav>

      <div className="border-t border-outline-variant p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-container text-base font-medium text-on-primary-container">
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
            className="state-layer flex size-11 shrink-0 items-center justify-center rounded-full text-on-surface-variant"
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
      aria-label="Navegação principal"
      // Marca para os avisos flutuantes subirem acima da barra (globals.css).
      data-tabbar=""
      // Barra de navegacao do M3: 80px, surface-container, sem divisor.
      className="pb-safe fixed inset-x-0 bottom-0 z-40 bg-surface-container lg:hidden"
    >
      <div className="mx-auto grid h-20 max-w-md grid-cols-5 items-center px-1">
        <TabLink {...first} active={isActive(pathname, first)} />
        <TabLink {...second} active={isActive(pathname, second)} />

        <div className="flex justify-center">
          <Link
            href="/textos/novo"
            aria-label="Importar novo texto"
            // FAB do M3: 56px, canto de 16px, primary-container, elevacao 3.
            className="state-layer -mt-5 flex size-14 items-center justify-center rounded-2xl bg-primary-container text-on-primary-container shadow-elevation-3"
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
      // Destino do M3: icone numa pilula de 64 x 32 (secondary-container no
      // destino atual) e rotulo em label-medium.
      className={`group flex h-full flex-col items-center justify-center gap-1 text-xs font-medium ${
        active ? "text-on-surface" : "text-on-surface-variant"
      }`}
    >
      <span
        className={`flex h-8 w-16 max-w-full items-center justify-center rounded-full transition-colors duration-200 ease-standard ${
          active
            ? "bg-secondary-container text-on-secondary-container"
            : "group-hover:bg-on-surface/8"
        }`}
      >
        <Icon className="size-6" />
      </span>
      {label}
    </Link>
  );
}
