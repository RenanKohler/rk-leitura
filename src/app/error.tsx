"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Algo deu errado</h1>
      <p className="max-w-sm text-muted">
        Nao foi possivel carregar esta tela. Tente de novo em instantes.
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
