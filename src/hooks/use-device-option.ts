"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Esconder cabecalho e rodape durante a leitura (US-213). Padrao: ligado. */
export const HIDE_CONTROLS_KEY = "rk-leitura:esconder-controles";

/** Vibrar ao mudar de secao no Word Runner (US-216). Padrao: desligado. */
export const SECTION_VIBRATION_KEY = "rk-leitura:vibrar-secao";

const EVENT = "rk-leitura:opcao-aparelho";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    if (value === "1") return true;
    if (value === "0") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Preferencia ligada ou desligada deste aparelho, em `localStorage`.
 *
 * Mesmo caminho do modo do play: gestos e vibracao dependem do aparelho, nao
 * da conta, e assim a opcao nao precisa de coluna nova no banco. No servidor
 * e no primeiro render vale o padrao.
 */
export function useDeviceOption(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback
  );
  const set = useCallback(
    (next: boolean) => {
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Sem armazenamento a opcao so nao fica guardada.
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key]
  );
  return [value, set];
}
