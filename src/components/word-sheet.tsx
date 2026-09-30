"use client";

import { useEffect, useState, type ReactNode } from "react";
import { apiSend } from "@/lib/client";
import { Alert, Button, Sheet, Spinner } from "@/components/ui";
import type { WordEntry } from "@/lib/dictionary";

/** Resposta de erro do dicionario: diz se a palavra ja esta guardada (PROD-6). */
interface LookupFailure {
  error?: string;
  saved?: boolean;
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
        setError(failure.error ?? "Nao consegui consultar.");
        setSaved(failure.saved === true);
      })
      .catch(() => {
        if (active) setError("Nao consegui consultar.");
      });

    return () => {
      active = false;
    };
  }, [word, context, textId]);

  const saveForReview = async () => {
    setSaving(true);
    setSaveError("");
    try {
      await apiSend("/api/palavras", "POST", { word, context, textId });
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Nao consegui guardar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={word}>
      <div className="space-y-4">
        {error ? (
          <div className="space-y-3">
            <Alert>{error}</Alert>
            {saved ? (
              <p className="text-sm text-muted" data-testid="palavra-guardada">
                Guardada para revisar, com a frase de origem. A definicao pode ser buscada de novo
                ou escrita em Palavras salvas.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted">
                  Da para guardar a palavra assim mesmo: ela entra na revisao com a frase em que
                  apareceu, e a definicao fica para depois.
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
                <span className="text-sm text-muted">Traducao: </span>
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
          Voltar a leitura
        </Button>
      </div>
    </Sheet>
  );
}
