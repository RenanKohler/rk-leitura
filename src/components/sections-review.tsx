"use client";

import { useState } from "react";
import { apiSend, consentFrom } from "@/lib/client";
import { Alert, Button } from "@/components/ui";
import { TrashIcon } from "@/components/icons";
import { AiConsentNotice, AiOffNotice, useAiConsent } from "@/components/ai-consent";
import { MAX_SECTION_TITLE_WORDS, type Section } from "@/lib/sections";

interface Draft extends Section {
  key: number;
}

/**
 * "Sugerir secoes" em "Navegar no texto" (US-153).
 *
 * A sugestao nunca se aplica sozinha: cada secao aparece para renomear ou
 * remover, e so "Aplicar" grava. O que vai para o texto e a marcacao de
 * navegacao, separada do conteudo.
 */
export function SectionsReview({
  textId,
  words,
  current,
  onApplied,
}: {
  textId: string;
  words: string[];
  /** Secoes ja aplicadas; com elas, a opcao vira "Revisar seções". */
  current: Section[];
  onApplied: (sections: Section[]) => void;
}) {
  const { state: consent } = useAiConsent();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState<"consent" | "off" | null>(null);

  const toDrafts = (sections: Section[]) =>
    sections.map((section, key) => ({ ...section, key }));

  const suggest = async () => {
    setLoading(true);
    setError("");
    setAsking(null);
    try {
      const { suggestions } = await apiSend<{ suggestions: Section[] }>(
        `/api/texts/${textId}/secoes`,
        "POST"
      );
      setDrafts(toDrafts(suggestions));
    } catch (cause) {
      const state = consentFrom(cause);
      if (state === "pending") setAsking("consent");
      else if (state === "off") setAsking("off");
      else setError(cause instanceof Error ? cause.message : "Não consegui sugerir seções agora.");
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!drafts) return;
    setSaving(true);
    setError("");
    try {
      const { sections } = await apiSend<{ sections: Section[] }>(
        `/api/texts/${textId}/secoes`,
        "PUT",
        { sections: drafts.map(({ index, title }) => ({ index, title })) }
      );
      onApplied(sections);
      setDrafts(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui aplicar as seções.");
    } finally {
      setSaving(false);
    }
  };

  const preview = (index: number) => {
    const slice = words.slice(index, index + 8).join(" ");
    return `${slice}${index + 8 < words.length ? " ..." : ""}`;
  };

  if (asking === "consent") {
    return (
      <AiConsentNotice
        onDecided={(allowed) => {
          setAsking(allowed ? null : "off");
          if (allowed) void suggest();
        }}
      />
    );
  }
  if (asking === "off") return <AiOffNotice />;

  if (!drafts) {
    // Conta com a IA desligada: a opcao nem aparece, como as demais funcoes.
    if (consent === "off" && current.length === 0) return null;
    return (
      <div className="space-y-2">
        {error ? <Alert>{error}</Alert> : null}
        {current.length > 0 ? (
          <Button variant="ghost" full onClick={() => setDrafts(toDrafts(current))}>
            Revisar seções
          </Button>
        ) : (
          <>
            <p className="text-sm text-muted">
              Este texto não tem títulos. A IA pode sugerir seções para navegar por ele, sem mudar o
              conteúdo.
            </p>
            <Button variant="secondary" full loading={loading} onClick={() => void suggest()}>
              {loading ? "Procurando as divisões" : "Sugerir seções"}
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="revisao-secoes">
      <p className="text-sm text-muted">
        {`Renomeie ou remova antes de aplicar. Títulos de até ${MAX_SECTION_TITLE_WORDS} palavras.`}
      </p>
      {error ? <Alert>{error}</Alert> : null}
      {drafts.length === 0 ? (
        <p className="text-sm text-faint">Nenhuma seção. Aplicar tira as seções do sumário.</p>
      ) : (
        <ol className="max-h-72 space-y-2 overflow-y-auto">
          {drafts.map((draft, position) => (
            <li key={draft.key} className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <input
                  type="text"
                  value={draft.title}
                  aria-label={`Título da seção ${position + 1}`}
                  onChange={(event) =>
                    setDrafts(
                      drafts.map((item) =>
                        item.key === draft.key ? { ...item, title: event.target.value } : item
                      )
                    )
                  }
                  className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-base"
                />
                <p className="line-clamp-1 px-1 text-xs text-faint">{preview(draft.index)}</p>
              </div>
              <button
                type="button"
                onClick={() => setDrafts(drafts.filter((item) => item.key !== draft.key))}
                aria-label={`Remover seção ${draft.title || position + 1}`}
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
              >
                <TrashIcon className="size-5" />
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={saving} onClick={() => setDrafts(null)}>
          Cancelar
        </Button>
        <Button
          loading={saving}
          disabled={drafts.some((draft) => !draft.title.trim())}
          onClick={() => void apply()}
        >
          Aplicar seções
        </Button>
      </div>
    </div>
  );
}
