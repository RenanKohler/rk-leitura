import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

/**
 * Sem verificacao de sessao aqui: o middleware ja barra visitantes antes de
 * qualquer HTML sair. Isso elimina a tela de "carregando" que antes piscava
 * em toda navegacao.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
