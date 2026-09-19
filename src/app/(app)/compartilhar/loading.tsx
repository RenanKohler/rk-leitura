import { Skeleton } from "@/components/ui";

/**
 * Limite de carregamento da rota.
 *
 * Importa mais aqui do que nas outras telas: o app abre direto nesta rota a
 * partir da folha de compartilhamento do sistema, entao sem ela o primeiro
 * quadro seria uma tela vazia enquanto a sessao e a biblioteca sao consultadas.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <header className="pt-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-56" />
      </header>
      <Skeleton className="h-40 w-full rounded-card" />
    </div>
  );
}
