"use client";

import { useEffect, useState } from "react";
import { newRefCode } from "@/lib/error-log";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Um codigo por erro exibido: e o que o leitor informa ao relatar, e o que
  // liga esta tela a linha gravada no log (US-73).
  const [ref] = useState(() => newRefCode());

  useEffect(() => {
    console.error(error);
    // O caminho vai sem a query: ela pode trazer o endereco importado.
    void fetch("/api/erros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref,
        name: error.name,
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        path: window.location.pathname,
      }),
      keepalive: true,
    }).catch(() => undefined);
  }, [error, ref]);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Algo deu errado</h1>
      <p className="max-w-sm text-muted">
        Nao foi possivel carregar esta tela. Tente de novo em instantes.
      </p>
      <p className="text-sm text-muted">
        Codigo de referencia: <span className="font-mono font-medium text-ink">{ref}</span>
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 inline-flex min-h-12 items-center rounded-full bg-accent px-6 font-medium text-accent-ink"
      >
        Tentar novamente
      </button>
    </main>
  );
}
