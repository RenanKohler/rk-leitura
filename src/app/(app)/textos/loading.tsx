import { Skeleton } from "@/components/ui";

/**
 * Limite de carregamento da rota.
 *
 * Serve a dois propositos: dar resposta imediata ao toque na navegacao, em vez
 * de meio segundo de tela parada, e permitir que o servidor envie a estrutura
 * da pagina antes de a consulta terminar - importante porque o banco do plano
 * gratuito hiberna e a primeira consulta depois disso demora.
 */
export default function Loading() {
  return (
    // Mesmas alturas do cabecalho curto e dos itens compactos da biblioteca
    // (US-230): quando a lista chega, nada pula de lugar.
    <div className="space-y-2">
      <header className="flex min-h-12 items-center">
        <Skeleton className="h-8 w-40" />
      </header>
      <Skeleton className="h-10.5 w-full rounded-full" />
      <Skeleton className="h-12 w-full rounded-full" />
      <div>
        <div className="flex min-h-11 items-center">
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-18 w-full rounded-card" />
          ))}
        </div>
      </div>
    </div>
  );
}
