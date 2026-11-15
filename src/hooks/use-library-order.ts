"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  asLibraryOrder,
  DEFAULT_LIBRARY_ORDER,
  LIBRARY_ORDER_COOKIE,
  LIBRARY_ORDER_KEY,
  type LibraryOrder,
} from "@/lib/library";

const EVENT = "rk-leitura:ordem-biblioteca";

/** Um ano. O cookie e regravado a cada troca e sempre que o servidor errar. */
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  // Outra aba trocou a ordem: esta acompanha.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(): LibraryOrder {
  try {
    return asLibraryOrder(localStorage.getItem(LIBRARY_ORDER_KEY));
  } catch {
    return DEFAULT_LIBRARY_ORDER;
  }
}

/**
 * So para as rotas da biblioteca (`path=/textos`): o cookie nao viaja nos
 * pedidos de API, que recebem a ordem em `?ordem=`.
 */
function writeCookie(order: LibraryOrder): void {
  document.cookie = `${LIBRARY_ORDER_COOKIE}=${order}; path=/textos; max-age=${COOKIE_MAX_AGE_S}; samesite=lax`;
}

/**
 * Ordem da biblioteca escolhida neste aparelho (US-230).
 *
 * A escolha mora em `localStorage`, como as outras opcoes do aparelho
 * (`use-device-option.ts`, que so guarda liga/desliga). Como a primeira tela
 * e montada no servidor, que nao le `localStorage`, a escolha vai tambem num
 * cookie: a pagina le o cookie e ja entrega a lista na ordem certa, sem a
 * troca visivel de pedir de novo depois de hidratar.
 *
 * `serverOrder` e a ordem que o servidor usou. Ela vale na hidratacao, para o
 * HTML bater, e e a referencia para saber se o cookie se perdeu (vencido, ou
 * apagado sem o `localStorage`): se o guardado aqui for outro, a tela pede a
 * lista de novo uma vez e o cookie e regravado para a proxima visita.
 */
export function useLibraryOrder(
  serverOrder: LibraryOrder
): [LibraryOrder, (next: LibraryOrder) => void] {
  const order = useSyncExternalStore(subscribe, read, () => serverOrder);

  useEffect(() => {
    if (order !== serverOrder) writeCookie(order);
  }, [order, serverOrder]);

  const set = useCallback((next: LibraryOrder) => {
    try {
      localStorage.setItem(LIBRARY_ORDER_KEY, next);
    } catch {
      // Sem armazenamento a ordem so nao fica guardada.
    }
    writeCookie(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [order, set];
}
