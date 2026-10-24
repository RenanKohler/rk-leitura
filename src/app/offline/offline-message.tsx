"use client";

import { useSyncExternalStore } from "react";
import { READER_OUTDATED } from "@/lib/offline";

const noop = () => () => undefined;

/**
 * O service worker devolve esta tela no lugar da pagina pedida, com o
 * endereco dela. Num texto do leitor sem copia desta versao do app, o aviso
 * diz o que fazer (US-176).
 */
export function OfflineMessage() {
  const reader = useSyncExternalStore(
    noop,
    () => window.location.pathname.startsWith("/leitor/"),
    () => false
  );
  return (
    <p className="max-w-xs text-muted" data-testid="offline-mensagem">
      {reader
        ? READER_OUTDATED
        : "Esta tela ainda não foi aberta com internet, então não há cópia dela aqui. Os textos que você já abriu continuam disponíveis."}
    </p>
  );
}
