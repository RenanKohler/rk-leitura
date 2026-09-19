"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { OFFLINE_TEXTS } from "@/lib/offline";

interface OfflineValue {
  /** Falso quando o navegador diz que nao ha rede. */
  online: boolean;
  /** Pede ao service worker que esvazie a fila agora. */
  flush: () => void;
}

const OfflineContext = createContext<OfflineValue>({ online: true, flush: () => {} });

/** Espera a tela assentar antes de baixar o que so sera usado offline. */
const WARM_DELAY_MS = 4_000;

/**
 * Baixa as paginas dos textos recentes para o cache do service worker.
 *
 * Uma de cada vez, de proposito: sao paginas grandes, e vinte pedidos
 * simultaneos competiriam com a leitura que esta acontecendo agora.
 */
async function warmCache(cancelled: () => boolean): Promise<void> {
  if (!navigator.onLine) return;

  try {
    const response = await fetch(`/api/texts/recentes?perPage=${OFFLINE_TEXTS}`);
    if (!response.ok) return;

    const data = (await response.json()) as { texts?: { id: string }[] };
    for (const text of data.texts ?? []) {
      if (cancelled() || !navigator.onLine) return;
      await fetch(`/leitor/${text.id}`, { credentials: "same-origin" }).catch(() => undefined);
    }
  } catch {
    // Aquecimento e melhoria, nao requisito: falhar aqui nao muda nada do
    // que esta na tela.
  }
}

/** Assinatura dos dois eventos de conexao do navegador. */
function subscribeToConnection(notify: () => void): () => void {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

export function useOffline() {
  return useContext(OfflineContext);
}

/**
 * Registra o service worker e acompanha o estado da conexao.
 *
 * `navigator.onLine` mente para mais: ele diz "online" em uma rede sem saida.
 * Serve aqui porque o uso e so avisar antes de tentar - quando ele mente, a
 * requisicao falha e cai na fila, que e o caminho correto de qualquer forma.
 */
export function OfflineProvider({ children }: { children: ReactNode }) {
  // Lido do proprio navegador em vez de guardado em estado: e uma condicao do
  // ambiente, e no servidor ela sai como "online" - o mesmo que o HTML diria.
  const online = useSyncExternalStore(subscribeToConnection, () => navigator.onLine, () => true);

  const flush = useCallback(() => {
    void navigator.serviceWorker?.ready.then((registration) =>
      registration.active?.postMessage({ type: "flush" })
    );
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Sem service worker o app continua inteiro; so nao le offline.
    });

    // Voltar a ter rede esvazia a fila; o resto do estado sai do navegador.
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [flush]);

  // Aquece o cache com a biblioteca recente, para que ficar offline nao
  // dependa de ter aberto cada texto antes. Roda depois da tela estar
  // pronta e em fila: e trabalho de fundo, nao pode disputar a leitura.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void warmCache(() => cancelled);
    }, WARM_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <OfflineContext.Provider value={{ online, flush }}>
      {children}
      {!online ? (
        <div className="pb-safe pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center">
          <p className="mb-20 rounded-full bg-ink px-4 py-2 text-sm font-medium text-bg shadow-float">
            Sem conexao. A leitura continua.
          </p>
        </div>
      ) : null}
    </OfflineContext.Provider>
  );
}
