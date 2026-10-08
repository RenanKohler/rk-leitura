"use client";

import { useEffect, useState, type ReactNode } from "react";
import { apiSend } from "@/lib/client";
import { Alert, Button, Sheet, Spinner } from "@/components/ui";
import { AiConsentNotice, AiOffNotice } from "@/components/ai-consent";
import type { WordEntry } from "@/lib/dictionary";

/** Resposta de erro do dicionario: diz se a palavra ja esta guardada (PROD-6). */
interface LookupFailure {
  error?: string;
  saved?: boolean;
  /** Conta sem permissao de envio ao servico de IA (US-125). */
  consent?: "pending" | "off";
}

/**
 * Painel de significado de uma palavra.
 *
 * Quem monta passa `key={word}`: a consulta comeca na montagem, entao trocar
 * de palavra e montar outro painel, nao sincronizar estado em um efeito.
 *
 * Quando a consulta falha (instalacao sem chave, cota do dia, servico fora),
 * o painel oferece "Guardar para revisar" (PROD-6): a palavra entra na revisao
 * com a frase de origem e a definicao vazia, que a proxima consulta tenta
 * preencher.
 *
 * `actions` e o espaco para acoes extras do leitor (por exemplo "Comecar
 * daqui" ou "Marcar a frase"): elas aparecem no rodape, acima de "Voltar a
 * leitura", com a consulta dando certo ou nao.
 */
export function WordSheet({
  word,
  context,
  textId,
  onClose,
  actions,
}: {
  word: string;
  context: string;
  textId: string;
  onClose: () => void;
  /** Acoes extras no rodape da folha. */
  actions?: ReactNode;
}) {
  const [entry, setEntry] = useState<WordEntry | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [consent, setConsent] = useState<"pending" | "off" | null>(null);
  // Muda quando a pessoa permite o envio: refaz a consulta.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    // `fetch` direto em vez de `apiSend`: na falha, o corpo diz se a palavra
    // ja estava guardada, e o erro generico do cliente perderia isso.
    void fetch("/api/dicionario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, context, textId }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as
          | { entry?: WordEntry }
          | LookupFailure;
        if (!active) return;
        if (response.ok && "entry" in data && data.entry) {
          setEntry(data.entry);
          return;
        }
        const failure = data as LookupFailure;
        if (response.status === 403 && failure.consent) {
          setConsent(failure.consent);
          setSaved(failure.saved === true);
          if (failure.consent === "off") setError(failure.error ?? "");
          return;
        }
        setError(failure.error ?? "Não consegui consultar.");
        setSaved(failure.saved === true);
      })
      .catch(() => {
        if (active) setError("Não consegui consultar.");
      });

    return () => {
      active = false;
    };
  }, [word, context, textId, attempt]);

  const decided = (allowed: boolean) => {
    if (allowed) {
      setConsent(null);
      setAttempt((value) => value + 1);
    } else {
      setConsent("off");
      setError("Sem envio ao serviço de IA, a definição fica para depois.");
    }
  };

  const saveForReview = async () => {
    setSaving(true);
    setSaveError("");
    try {
      await apiSend("/api/palavras", "POST", { word, context, textId });
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Não consegui guardar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={word}>
      <div className="space-y-4">
        {consent === "pending" ? (
          <AiConsentNotice onDecided={decided} />
        ) : error ? (
          <div className="space-y-3">
            {consent === "off" ? <AiOffNotice /> : <Alert>{error}</Alert>}
            {saved ? (
              <p className="text-sm text-muted" data-testid="palavra-guardada">
                Guardada para revisar, com a frase de origem. A definição pode ser buscada de novo
                ou escrita em Palavras salvas.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted">
                  Dá para guardar a palavra assim mesmo: ela entra na revisão com a frase em que
                  apareceu, e a definição fica para depois.
                </p>
                {saveError ? <Alert>{saveError}</Alert> : null}
                <Button variant="secondary" size="lg" full loading={saving} onClick={saveForReview}>
                  Guardar para revisar
                </Button>
              </>
            )}
          </div>
        ) : entry ? (
          <>
            <div>
              <p className="text-lg font-semibold tracking-tight">{entry.base}</p>
              {entry.kind ? <p className="text-sm text-faint">{entry.kind}</p> : null}
            </div>
            {/* Palavra de outro idioma: a traducao vem antes da definicao. */}
            {entry.translation ? (
              <p className="font-medium">
                <span className="text-sm text-muted">Tradução: </span>
                {entry.translation}
              </p>
            ) : null}
            <p className="leading-relaxed">{entry.definition}</p>
            <p className="text-sm text-faint">
              Guardada em Palavras salvas, junto com o texto de origem.
            </p>
          </>
        ) : (
          <div className="flex items-center gap-3 py-4 text-muted">
            <Spinner className="size-5" />
            Consultando
          </div>
        )}

        {actions ? <div className="space-y-2">{actions}</div> : null}

        <Button size="lg" full onClick={onClose}>
          Voltar à leitura
        </Button>
      </div>
    </Sheet>
  );
}
