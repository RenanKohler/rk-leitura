"use client";

import { useEffect, useState } from "react";
import { apiSend } from "@/lib/client";
import { Alert, Button, Sheet, Spinner } from "@/components/ui";
import type { WordEntry } from "@/lib/dictionary";

/**
 * Painel de significado de uma palavra.
 *
 * Quem monta passa `key={word}`: a consulta comeca na montagem, entao trocar
 * de palavra e montar outro painel, nao sincronizar estado em um efeito.
 */
export function WordSheet({
  word,
  context,
  textId,
  onClose,
}: {
  word: string;
  context: string;
  textId: string;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<WordEntry | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    void apiSend<{ entry: WordEntry }>("/api/dicionario", "POST", { word, context, textId })
      .then((data) => {
        if (active) setEntry(data.entry);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Nao consegui consultar.");
        }
      });

    return () => {
      active = false;
    };
  }, [word, context, textId]);

  return (
    <Sheet open onClose={onClose} title={word}>
      <div className="space-y-4">
        {error ? (
          <Alert>{error}</Alert>
        ) : entry ? (
          <>
            <div>
              <p className="text-lg font-semibold tracking-tight">{entry.base}</p>
              {entry.kind ? <p className="text-sm text-faint">{entry.kind}</p> : null}
            </div>
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

        <Button size="lg" full onClick={onClose}>
          Voltar a leitura
        </Button>
      </div>
    </Sheet>
  );
}
