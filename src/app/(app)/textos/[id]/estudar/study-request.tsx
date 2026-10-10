"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { AiConsentNotice, AiOffNotice } from "@/components/ai-consent";
import { consentFrom } from "@/lib/client";
import { wordNumber } from "@/lib/ask";

/**
 * Pedido de uma ferramenta de estudo (US-164, US-165, US-167), com o aviso
 * de consentimento no lugar do resultado quando a conta ainda nao decidiu.
 * Permitir refaz o mesmo pedido.
 */
export function useStudyRequest(failure: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState<"pending" | "off" | null>(null);
  const last = useRef<(() => Promise<void>) | null>(null);

  const run = useCallback(
    async (task: () => Promise<void>) => {
      last.current = task;
      setError("");
      setConsent(null);
      setBusy(true);
      try {
        await task();
      } catch (cause) {
        const state = consentFrom(cause);
        if (state) setConsent(state);
        else setError(cause instanceof Error ? cause.message : failure);
      } finally {
        setBusy(false);
      }
    },
    [failure]
  );

  const notice: ReactNode =
    consent === "pending" ? (
      <AiConsentNotice
        onDecided={(allowed) => {
          if (allowed && last.current) void run(last.current);
          else setConsent("off");
        }}
      />
    ) : consent === "off" ? (
      <AiOffNotice />
    ) : null;

  return { run, busy, error, notice };
}

/** Endereco do leitor aberto numa posicao (`?de=`, como a lista de destaques). */
export function readerAt(textId: string, position: number): string {
  return `/leitor/${textId}?de=${Math.max(0, Math.trunc(position))}`;
}

/** Citacao que abre o leitor no trecho citado. */
export function QuoteLink({
  textId,
  start,
  quote,
}: {
  textId: string;
  start: number;
  quote: string;
}): ReactNode {
  return (
    <Link
      href={readerAt(textId, start)}
      className="block border-l-2 border-border pl-3 text-sm text-muted hover:border-accent hover:text-ink"
      aria-label={`Abrir no texto, palavra ${wordNumber(start)}: ${quote}`}
    >
      “{quote}”
    </Link>
  );
}
