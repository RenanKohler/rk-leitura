"use client";

import { useState } from "react";
import { AiConsentNotice, AiOffNotice, useAiConsent } from "@/components/ai-consent";
import { apiSend, consentFrom } from "@/lib/client";
import { canAskSynopsis } from "@/lib/synopsis";
import type { TextSummary } from "@/lib/types";

/**
 * Sinopse sem spoiler no cartao da biblioteca (US-138).
 *
 * A guardada vem com a lista e aparece direto; sem ela, o botao "Do que se
 * trata?" pede uma, so para texto nao iniciado e com pelo menos 200 palavras.
 * Sem permissao da conta, o aviso de consentimento aparece no lugar do botao.
 */
export function TextSynopsis({ text }: { text: TextSummary }) {
  const { state } = useAiConsent();
  const [synopsis, setSynopsis] = useState<string | null>(text.synopsis ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState<"pending" | "off" | null>(null);

  const request = async () => {
    setError("");
    setBusy(true);
    try {
      const result = await apiSend<{ synopsis: string }>(`/api/texts/${text.id}/sinopse`, "POST");
      setSynopsis(result.synopsis);
    } catch (cause) {
      const refused = consentFrom(cause);
      if (refused) setConsent(refused);
      else setError(cause instanceof Error ? cause.message : "Não consegui gerar a sinopse agora.");
    } finally {
      setBusy(false);
    }
  };

  // Pergunta antes de qualquer envio; o servidor confere de novo.
  const ask = () => (state === "on" ? void request() : setConsent(state));

  if (synopsis) {
    return (
      <p className="mt-3 text-sm leading-relaxed text-muted" data-testid="sinopse">
        <span className="font-medium text-ink">Do que se trata: </span>
        {synopsis}
      </p>
    );
  }

  if (!canAskSynopsis(text)) return null;

  if (consent === "pending") {
    return (
      <div className="mt-3 rounded-2xl border border-border p-3">
        <AiConsentNotice
          onDecided={(allowed) => {
            setConsent(allowed ? null : "off");
            // O estado da conta ainda nao chegou ao hook: pede direto.
            if (allowed) void request();
          }}
        />
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {consent === "off" ? (
        <AiOffNotice />
      ) : (
        <button
          type="button"
          onClick={ask}
          disabled={busy}
          aria-busy={busy}
          className="inline-flex min-h-9 items-center rounded-full border border-border px-3 text-sm font-medium text-muted disabled:opacity-60"
        >
          {busy ? "Lendo o começo..." : "Do que se trata?"}
        </button>
      )}
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
