"use client";

import { useEffect, useRef } from "react";

type WakeLockSentinel = { release: () => Promise<void>; released: boolean };
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
};

/**
 * Mantem a tela acesa durante a leitura.
 *
 * Sem isso o celular apaga no meio de uma sessao de leitura, ja que o usuario
 * nao toca em nada. A API nao existe em todos os navegadores, entao qualquer
 * falha e ignorada silenciosamente.
 */
export function useWakeLock(active: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLock) return;

    let cancelled = false;

    const acquire = async () => {
      try {
        const sentinel = await wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Bloqueado pelo navegador ou aba em segundo plano: seguir sem.
      }
    };

    const release = () => {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel && !sentinel.released) void sentinel.release();
    };

    // O sistema solta o bloqueio ao trocar de aba; readquire ao voltar.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && active) void acquire();
    };

    if (active) {
      void acquire();
      document.addEventListener("visibilitychange", onVisibilityChange);
    } else {
      release();
    }

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      release();
    };
  }, [active]);
}
