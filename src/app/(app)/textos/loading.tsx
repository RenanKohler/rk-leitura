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
    <div className="space-y-6">
      <header className="pt-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-32" />
      </header>
      <Skeleton className="h-36 w-full rounded-card" />
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-card" />
        ))}
      </div>
    </div>
  );
}
