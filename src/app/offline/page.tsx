import Link from "next/link";

export const dynamic = "force-static";

/**
 * Tela que o service worker mostra quando a navegacao falha e nao ha copia
 * guardada da pagina pedida.
 *
 * Estatica de proposito: ela precisa existir no cache sem depender de sessao
 * nem de banco, porque e justamente quando nada disso esta alcancavel que ela
 * aparece.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Sem conexao</h1>
      <p className="max-w-xs text-muted">
        Esta tela ainda nao foi aberta com internet, entao nao ha copia dela aqui. Os textos que
        voce ja abriu continuam disponiveis.
      </p>
      <Link
        href="/textos"
        className="inline-flex min-h-12 items-center rounded-full bg-accent px-6 font-medium text-accent-ink"
      >
        Ver meus textos
      </Link>
    </div>
  );
}
