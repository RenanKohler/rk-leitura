"use client";

import { useEffect, useState } from "react";
import { AiConsentNotice, AiOffNotice } from "@/components/ai-consent";
import { Alert, Button, Sheet, Spinner } from "@/components/ui";
import { EXPLAIN_FAILURE, EXPLAIN_TIMEOUT_MS, type Explanation } from "@/lib/explain";

/** Folga sobre o teto do servidor: banco e rede antes e depois da chamada. */
const CLIENT_TIMEOUT_MS = EXPLAIN_TIMEOUT_MS + 5_000;

interface ExplainResponse {
  explanation?: Explanation;
  sentence?: string;
  error?: string;
  /** Conta sem permissao de envio ao servico de IA (US-125). */
  consent?: "pending" | "off";
}

/**
 * Explicacao de uma frase dificil (US-127).
 *
 * Quem monta passa `key={index}`: o pedido comeca na montagem. A folha nao
 * mexe na posicao de leitura: com a explicacao, com o limite do dia ou com a
 * falha, fechar volta para a mesma palavra.
 */
export function ExplainSheet({
  textId,
  index,
  onClose,
}: {
  textId: string;
  /** Palavra tocada; a frase vem do segmentador, no servidor. */
  index: number;
  onClose: () => void;
}) {
  const [result, setResult] = useState<{ explanation: Explanation; sentence: string } | null>(
    null
  );
  const [error, setError] = useState("");
  const [consent, setConsent] = useState<"pending" | "off" | null>(null);
  // Muda quando a pessoa permite o envio: refaz o pedido.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    void fetch(`/api/texts/${textId}/explicacao`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as ExplainResponse;
        if (!active) return;
        if (response.ok && data.explanation) {
          setResult({ explanation: data.explanation, sentence: data.sentence ?? "" });
          return;
        }
        if (response.status === 403 && data.consent) {
          setConsent(data.consent);
          return;
        }
        setError(data.error ?? EXPLAIN_FAILURE);
      })
      .catch(() => {
        if (active) setError(EXPLAIN_FAILURE);
      })
      .finally(() => clearTimeout(timer));

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [textId, index, attempt]);

  const decided = (allowed: boolean) => {
    if (allowed) {
      setConsent(null);
      setAttempt((value) => value + 1);
    } else {
      setConsent("off");
    }
  };

  const explanation = result?.explanation;

  return (
    <Sheet open onClose={onClose} title="Explicar frase">
      <div className="space-y-4" data-testid="explicacao">
        {consent === "pending" ? (
          <AiConsentNotice onDecided={decided} />
        ) : consent === "off" ? (
          <AiOffNotice />
        ) : error ? (
          <Alert>{error}</Alert>
        ) : explanation ? (
          <>
            {result.sentence ? (
              <blockquote className="border-l-2 border-border pl-3 text-sm text-muted">
                {result.sentence}
              </blockquote>
            ) : null}
            {/* Frase de outro idioma: a traducao vem antes da reescrita. */}
            {explanation.translation ? (
              <div>
                <p className="text-sm text-muted">Tradução</p>
                <p className="leading-relaxed">{explanation.translation}</p>
              </div>
            ) : null}
            <div>
              <p className="text-sm text-muted">Em outras palavras</p>
              <p className="font-medium leading-relaxed">{explanation.simple}</p>
            </div>
            <div>
              <p className="text-sm text-muted">Explicação</p>
              <p className="leading-relaxed">{explanation.explanation}</p>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3 py-4 text-muted">
            <Spinner className="size-5" />
            Explicando
          </div>
        )}

        <Button size="lg" full onClick={onClose}>
          Voltar à leitura
        </Button>
      </div>
    </Sheet>
  );
}
