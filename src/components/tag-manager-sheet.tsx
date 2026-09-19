"use client";

import { useState } from "react";
import { apiSend } from "@/lib/client";
import { Alert, Button, Field, Sheet } from "@/components/ui";
import { CheckIcon, EditIcon, TrashIcon } from "@/components/icons";
import { MAX_TAG_CHARS, normalizeTagName } from "@/lib/tags";
import type { TagSummary } from "@/lib/types";

/**
 * Renomear e excluir etiquetas.
 *
 * As duas acoes valem para todos os textos de uma vez, porque o vinculo e com
 * a etiqueta e nao com o nome dela. Excluir some com a etiqueta da conta e
 * desfaz os vinculos; os textos ficam onde estao.
 */
export function TagManagerSheet({
  open,
  tags,
  onClose,
  onChange,
}: {
  open: boolean;
  tags: TagSummary[];
  onClose: () => void;
  onChange: (tags: TagSummary[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (action: () => Promise<{ tags: TagSummary[] }>) => {
    setBusy(true);
    setError("");
    try {
      onChange((await action()).tags);
      setEditingId(null);
      setConfirmingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao consegui salvar.");
    } finally {
      setBusy(false);
    }
  };

  const rename = (id: string) =>
    run(() => apiSend<{ tags: TagSummary[] }>(`/api/etiquetas/${id}`, "PATCH", { name: draft }));

  const remove = (id: string) =>
    run(() => apiSend<{ tags: TagSummary[] }>(`/api/etiquetas/${id}`, "DELETE"));

  return (
    <Sheet open={open} onClose={onClose} title="Etiquetas">
      <div className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}

        {tags.length === 0 ? (
          <p className="text-sm text-muted">
            Nenhuma etiqueta ainda. Elas nascem ao editar um texto.
          </p>
        ) : (
          <ul className="space-y-2">
            {tags.map((tag) => (
              <li key={tag.id} className="rounded-2xl border border-border p-3">
                {editingId === tag.id ? (
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Field
                        name={`etiqueta-${tag.id}`}
                        maxLength={MAX_TAG_CHARS}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                      />
                    </div>
                    <Button
                      size="md"
                      loading={busy}
                      disabled={normalizeTagName(draft) === null}
                      onClick={() => void rename(tag.id)}
                    >
                      <CheckIcon className="size-5" />
                    </Button>
                  </div>
                ) : confirmingId === tag.id ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted">
                      {tag.texts === 0
                        ? "Excluir esta etiqueta?"
                        : `Excluir e tirar a etiqueta de ${tag.texts} ${tag.texts === 1 ? "texto" : "textos"}?`}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        full
                        onClick={() => setConfirmingId(null)}
                      >
                        Cancelar
                      </Button>
                      <Button variant="danger" full loading={busy} onClick={() => void remove(tag.id)}>
                        Excluir
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{tag.name}</p>
                      <p className="text-sm text-muted">
                        {tag.texts === 1 ? "1 texto" : `${tag.texts} textos`}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Renomear ${tag.name}`}
                      onClick={() => {
                        setDraft(tag.name);
                        setEditingId(tag.id);
                      }}
                      className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2"
                    >
                      <EditIcon className="size-5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Excluir ${tag.name}`}
                      onClick={() => setConfirmingId(tag.id)}
                      className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"
                    >
                      <TrashIcon className="size-5" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
