import Link from "next/link";

export const dynamic = "force-static";

export const metadata = { title: "Sem conexão" };

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
      <h1 className="text-xl font-semibold tracking-tight">Sem conexão</h1>
      <p className="max-w-xs text-muted">
        Esta tela ainda não foi aberta com internet, então não há cópia dela aqui. Os textos que
        você já abriu continuam disponíveis.
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
