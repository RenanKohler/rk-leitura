"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/components/providers";
import {
  HistoryIcon,
  HomeIcon,
  LibraryIcon,
  LogoMark,
  LogoutIcon,
  PlusIcon,
  SettingsIcon,
} from "@/components/icons";

const NAV = [
  { href: "/dashboard", label: "Inicio", Icon: HomeIcon },
  { href: "/textos", label: "Textos", Icon: LibraryIcon },
  { href: "/historico", label: "Historico", Icon: HistoryIcon },
  { href: "/ajustes", label: "Ajustes", Icon: SettingsIcon },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
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

  if (immersive) return <>{children}</>;

  return (
    <div className="min-h-dvh">
      <DesktopSidebar pathname={pathname} name={user?.name} email={user?.email} onLogout={logout} />

      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-3xl px-4 pt-4 pb-28 sm:px-6 lg:pb-10">{children}</main>
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

      <nav className="flex-1 space-y-1 px-3">
        {NAV.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
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
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
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
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-lg lg:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 items-center px-1">
        <TabLink {...first} active={isActive(pathname, first.href)} />
        <TabLink {...second} active={isActive(pathname, second.href)} />

        <div className="flex justify-center">
          <Link
            href="/textos/novo"
            aria-label="Importar novo texto"
            className="-mt-5 flex size-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-float transition-transform active:scale-95"
          >
            <PlusIcon className="size-6" strokeWidth={2.2} />
          </Link>
        </div>

        <TabLink {...third} active={isActive(pathname, third.href)} />
        <TabLink {...fourth} active={isActive(pathname, fourth.href)} />
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
