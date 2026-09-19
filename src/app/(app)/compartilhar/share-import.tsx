"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend } from "@/lib/client";
import { Alert, Button, Card, LinkButton, Spinner } from "@/components/ui";
import { LinkIcon } from "@/components/icons";
import type { ShareResult } from "@/lib/types";

/**
 * Importa o endereco recebido do compartilhamento e abre o leitor.
 *
 * A tela existe para dar retorno enquanto a pagina de origem e buscada, o que
 * leva alguns segundos: sem ela o app abriria em branco ate a importacao
 * terminar, e uma falha de rede pareceria travamento.
 */
export function ShareImport({
  url,
  title,
  autoStart,
}: {
  url: string;
  title: string | null;
  autoStart: boolean;
}) {
  // Zero significa "ainda nao comecou". O compartilhamento de verdade ja entra
  // importando; um link de outro site espera o toque.
  const [attempt, setAttempt] = useState(autoStart ? 1 : 0);
  const [error, setError] = useState("");
  const router = useRouter();

  // Guarda a requisicao, nao um sinalizador: assim o remonte em modo estrito
  // reaproveita a que ja esta em curso em vez de disparar uma segunda.
  const inFlight = useRef<Promise<ShareResult> | null>(null);

  useEffect(() => {
    if (attempt === 0) return;

    const request = inFlight.current ?? apiSend<ShareResult>("/api/share", "POST", { url });
    inFlight.current = request;

    let active = true;
    void request
      .then((result) => {
        if (active) router.replace(`/leitor/${result.id}`);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        inFlight.current = null;
        setError(cause instanceof Error ? cause.message : "Falha ao importar.");
      });

    return () => {
      active = false;
    };
  }, [url, attempt, router]);

  const retry = () => {
    setError("");
    setAttempt((value) => value + 1);
  };

  const running = attempt > 0 && !error;

  return (
    <div className="space-y-6">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {running ? "Importando" : "Link compartilhado"}
        </h1>
        {title ? <p className="mt-1 truncate text-sm text-muted">{title}</p> : null}
      </header>

      <Card className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-accent">
            {running ? <Spinner className="size-5" /> : <LinkIcon className="size-5" />}
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{hostOf(url)}</p>
            <p className="break-all text-sm text-muted">{url}</p>
          </div>
        </div>

        {error ? <Alert>{error}</Alert> : null}

        {running ? (
          <p className="text-sm text-muted">
            Buscando a pagina e extraindo o texto. O leitor abre sozinho quando terminar.
          </p>
        ) : (
          <div className="space-y-2">
            <Button size="lg" full onClick={retry}>
              {error ? "Tentar de novo" : "Importar e ler"}
            </Button>
            <LinkButton href="/textos/novo" variant="ghost" size="lg" full>
              Abrir o importador
            </LinkButton>
          </div>
        )}
      </Card>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
