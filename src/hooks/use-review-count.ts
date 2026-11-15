"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client";
import { REVIEW_CHANGED_EVENT, dueCount } from "@/lib/app-nav";

/**
 * Itens vencidos na Revisao do dia, para o selo da aba "Revisar" (US-229).
 *
 * Busca ao montar e a cada troca de rota, um pedido por navegacao. Fora da
 * navegacao ha dois outros momentos em que o numero muda sem a rota mudar:
 * um item respondido ou tirado na propria Revisao do dia (a tela avisa por
 * `REVIEW_CHANGED_EVENT`) e o app voltando para a frente, que pode ser no dia
 * seguinte, com itens novos vencidos. A barra desenha sem esperar - o numero
 * anterior fica ate o novo chegar, entao o selo nao pisca a cada toque.
 *
 * Falha ou falta de rede viram zero (sem selo), sem aviso: o selo e um
 * convite, e um numero que nao deu para conferir e pior que nenhum.
 *
 * `pathname` nulo desliga a busca: o leitor nao tem barra para mostrar o selo.
 */
export function useReviewCount(pathname: string | null): number {
  const [total, setTotal] = useState(0);
  // Pedidos fora da troca de rota: cada aviso soma um e refaz a busca.
  const [refresh, setRefresh] = useState(0);
  const enabled = pathname !== null;

  useEffect(() => {
    if (!enabled) return;
    const again = () => setRefresh((count) => count + 1);
    const onVisible = () => {
      if (document.visibilityState === "visible") again();
    };
    window.addEventListener(REVIEW_CHANGED_EVENT, again);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(REVIEW_CHANGED_EVENT, again);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  useEffect(() => {
    if (pathname === null) return;
    // Trocar de rota (ou um aviso novo) antes da resposta cancela o pedido
    // anterior: so o mais recente escreve o numero.
    const controller = new AbortController();

    apiGet<{ total?: unknown }>("/api/revisar/contagem", controller.signal)
      .then((result) => setTotal(dueCount(result.total)))
      .catch(() => {
        if (!controller.signal.aborted) setTotal(0);
      });

    return () => controller.abort();
  }, [pathname, refresh]);

  return total;
}
