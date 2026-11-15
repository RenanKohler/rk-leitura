"use client";

import { useState } from "react";
import { AiConsentNotice, AiOffNotice, useAiConsent } from "@/components/ai-consent";
import { SparkIcon } from "@/components/icons";
import { apiSend, consentFrom } from "@/lib/client";
import { canAskSynopsis } from "@/lib/synopsis";
import type { TextSummary } from "@/lib/types";

/**
 * Sinopse sem spoiler de um texto da biblioteca (US-138).
 *
 * Mora na folha "Mais acoes" do item (US-230). No cartao, a sinopse guardada
 * e o botao somavam de uma a quatro linhas por texto, e a lista mostrava dois
 * textos por tela. A guardada vem com a lista e aparece direto ao abrir a
 * folha; sem ela, "Do que se trata?" pede uma, so para texto nao iniciado e
 * com pelo menos 200 palavras, e a resposta aparece ali mesmo, com a folha
 * aberta. Sem permissao da conta, o aviso de consentimento aparece no lugar
 * do botao.
 *
 * `onGenerated` avisa a lista: sem isso, fechar e abrir a folha de novo
 * mostraria o botao outra vez, e o toque seguinte faria outro pedido.
 */
export function TextSynopsis({
  text,
  onGenerated,
}: {
  text: TextSummary;
  onGenerated?: (synopsis: string) => void;
}) {
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
      onGenerated?.(result.synopsis);
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
      <p className="text-sm leading-relaxed text-muted" data-testid="sinopse">
        <span className="font-medium text-ink">Do que se trata: </span>
        {synopsis}
      </p>
    );
  }

  if (!canAskSynopsis(text)) return null;

  if (consent === "pending") {
    return (
      <div className="rounded-2xl border border-border p-3">
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
    <div className="space-y-2">
      {consent === "off" ? (
        <AiOffNotice />
      ) : (
        <button
          type="button"
          onClick={ask}
          disabled={busy}
          aria-busy={busy}
          // Mesma linha das outras acoes da folha, com 48px de alvo de toque.
          className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
        >
          <SparkIcon className="size-5" />
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
