"use client";

import { useState } from "react";
import { Alert, Button, Sheet, TextArea } from "@/components/ui";
import { TrashIcon } from "@/components/icons";
import { MAX_NOTE_CHARS } from "@/lib/highlights";
import type { HighlightItem } from "@/lib/types";

/**
 * Folha de um destaque: o trecho, a nota e a remocao.
 *
 * A nota abre ja editavel. Um passo a mais ("ver nota" e depois "editar")
 * transformaria um comentario de uma linha em tres toques.
 *
 * Quem monta passa `key={mark.id}`: a nota e o estado de confirmacao nascem do
 * destaque aberto, entao trocar de destaque e montar outra folha, nao
 * sincronizar campos em um efeito.
 */
export function HighlightSheet({
  mark,
  onClose,
  onSaveNote,
  onRemove,
}: {
  mark: HighlightItem;
  onClose: () => void;
  onSaveNote: (note: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [note, setNote] = useState(mark.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setSaving(true);
    setError("");
    try {
      await action();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao consegui salvar.");
    } finally {
      setSaving(false);
    }
  };

  const changed = (mark.note ?? "") !== note.trim();

  return (
    <Sheet open onClose={onClose} title="Destaque">
      <div className="space-y-5">
        {error ? <Alert>{error}</Alert> : null}

        <blockquote className="border-l-2 border-mark pl-3 text-sm leading-relaxed text-muted">
          {mark.excerpt}
        </blockquote>

        <div className="space-y-1.5">
          <TextArea
            label="Nota"
            rows={4}
            maxLength={MAX_NOTE_CHARS}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="O que voce pensou sobre este trecho"
          />
          <p className="tabular text-right text-xs text-faint">
            {`${note.length} / ${MAX_NOTE_CHARS}`}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            full
            loading={saving}
            disabled={!changed}
            onClick={() => void run(() => onSaveNote(note))}
          >
            {note.trim().length === 0 && mark.note ? "Remover a nota" : "Salvar nota"}
          </Button>

          {confirming ? (
            <Button
              variant="danger"
              size="lg"
              full
              loading={saving}
              onClick={() => void run(onRemove)}
            >
              Confirmar remocao
            </Button>
          ) : (
            <Button variant="secondary" size="lg" full onClick={() => setConfirming(true)}>
              <TrashIcon className="size-5" />
              Remover destaque
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
