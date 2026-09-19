"use client";

import { useState } from "react";
import { Field } from "@/components/ui";
import { CloseIcon, PlusIcon } from "@/components/icons";
import { MAX_TAG_CHARS, MAX_TAGS_PER_TEXT, normalizeTagName, sameTag } from "@/lib/tags";

/**
 * Escolha de etiquetas de um texto.
 *
 * As ja usadas aparecem como sugestao para toque, e o campo cria as novas.
 * Sem a sugestao, cada texto ganharia uma grafia diferente da mesma etiqueta
 * e o filtro deixaria de reunir o que deveria.
 */
export function TagPicker({
  known,
  value,
  onChange,
}: {
  known: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const full = value.length >= MAX_TAGS_PER_TEXT;
  const suggestions = known.filter((name) => !value.some((chosen) => sameTag(chosen, name)));

  const add = (raw: string) => {
    const name = normalizeTagName(raw);
    if (!name || full) return;
    if (value.some((chosen) => sameTag(chosen, name))) return;
    onChange([...value, name]);
    setDraft("");
  };

  const remove = (name: string) => onChange(value.filter((item) => item !== name));

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted">Etiquetas</p>

      {value.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {value.map((name) => (
            <span
              key={name}
              className="flex min-h-9 items-center gap-1 rounded-full bg-accent-soft pl-3 pr-1 text-sm font-medium"
            >
              {name}
              <button
                type="button"
                onClick={() => remove(name)}
                aria-label={`Remover ${name}`}
                className="flex size-7 items-center justify-center rounded-full text-muted hover:text-ink"
              >
                <CloseIcon className="size-4" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field
            name="etiqueta"
            maxLength={MAX_TAG_CHARS}
            placeholder={full ? `Maximo de ${MAX_TAGS_PER_TEXT}` : "estudo, trabalho, lazer"}
            disabled={full}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter dentro de uma folha com botao de salvar: sem o
              // preventDefault, criar a etiqueta enviaria o formulario junto.
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                add(draft);
              }
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => add(draft)}
          disabled={full || normalizeTagName(draft) === null}
          aria-label="Adicionar etiqueta"
          className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border text-muted disabled:opacity-45"
        >
          <PlusIcon className="size-5" />
        </button>
      </div>

      {suggestions.length > 0 && !full ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => add(name)}
              className="flex min-h-9 items-center rounded-full border border-border px-3 text-sm text-muted"
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
