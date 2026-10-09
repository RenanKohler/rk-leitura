"use client";

import { Field } from "@/components/ui";

/**
 * Campo da previa da importacao que pode vir preenchido pela IA (US-152):
 * titulo ou autor. A marca "Sugerido" fica ate a pessoa mexer no valor; o que
 * ela digita vale sempre.
 */
export function SuggestedField({
  label,
  name,
  value,
  suggested,
  placeholder,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  suggested: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={name} className="block text-sm font-medium text-muted">
          {label}
        </label>
        {suggested ? (
          <span className="text-xs font-medium text-accent" data-testid={`sugerido-${name}`}>
            Sugerido
          </span>
        ) : null}
      </div>
      <Field
        id={name}
        name={name}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** Titulo e autor sugeridos pela analise da previa (US-152). */
export interface SuggestedMeta {
  suggestedTitle: string | null;
  suggestedAuthor: string | null;
}
