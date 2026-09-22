import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession, sessionIsCurrent } from "@/lib/auth";
import { loadAccount } from "@/lib/queries";

/**
 * O middleware ja barra visitantes antes de qualquer HTML sair, entao aqui nao
 * ha verificacao de sessao - e o que elimina a tela de "carregando" que antes
 * piscava em toda navegacao.
 *
 * O que ele nao consegue verificar e se a conta ainda existe: roda no Edge, sem
 * banco, e um token de conta apagada continua com assinatura valida. Esta
 * consulta cobre esse caso, e tambem o token revogado por troca de senha ou
 * por "sair de todos os aparelhos". Ela nao custa uma ida a mais ao banco: e a
 * mesma que o layout raiz ja faz, servida pelo cache de requisicao do Next.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (session) {
    const account = await loadAccount(session.id);
    if (!sessionIsCurrent(session, account?.sessionVersion ?? null)) redirect("/sair");
  }

  return <AppShell>{children}</AppShell>;
}
