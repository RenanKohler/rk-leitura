"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiSend } from "@/lib/client";
import { Alert, Button, Sheet } from "@/components/ui";
import { BookmarkIcon, TrashIcon } from "@/components/icons";
import {
  bookmarkLabel,
  currentHeading,
  MAX_BOOKMARK_LABEL,
  MAX_SEARCH_RESULTS,
  searchWords,
  textHeadings,
} from "@/lib/navigation";
import type { Paragraph } from "@/lib/reading";

interface Bookmark {
  id: string;
  position: number;
  label: string;
}

/**
 * Navegar dentro do texto aberto: buscar (US-90), ir por titulo (US-89) e
 * marcar posicoes para voltar (US-92).
 *
 * Toda ida a uma posicao passa por `onGo`, que pausa a leitura: pular com o
 * texto andando faria o leitor perder o ponto que acabou de escolher.
 */
export function NavigateSheet({
  open,
  onClose,
  textId,
  words,
  paragraphs,
  index,
  onGo,
}: {
  open: boolean;
  onClose: () => void;
  textId: string;
  words: string[];
  paragraphs: Paragraph[];
  index: number;
  onGo: (position: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const results = useMemo(() => searchWords(words, query), [words, query]);
  const headings = useMemo(() => textHeadings(paragraphs), [paragraphs]);
  const section = currentHeading(headings, index);

  const [bookmarks, setBookmarks] = useState<Bookmark[] | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void apiGet<{ bookmarks: Bookmark[] }>(`/api/texts/${textId}/marcadores`)
      .then((data) => {
        if (active) setBookmarks(data.bookmarks);
      })
      .catch(() => {
        if (active) setError("Nao consegui carregar os marcadores.");
      });
    return () => {
      active = false;
    };
  }, [open, textId]);

  const goToResult = (position: number) => {
    const target = results[position];
    if (target === undefined) return;
    setSelected(position);
    onGo(target);
  };

  const step = (direction: 1 | -1) => {
    if (results.length === 0) return;
    // Circular: depois do ultimo vem o primeiro.
    goToResult((selected + direction + results.length) % results.length);
  };

  const addBookmark = async () => {
    setSaving(true);
    setError("");
    try {
      const data = await apiSend<{ bookmarks: Bookmark[] }>(`/api/texts/${textId}/marcadores`, "POST", {
        position: index,
        label: label.trim() || bookmarkLabel(words, index),
      });
      setBookmarks(data.bookmarks);
      setLabel("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao consegui criar o marcador.");
    } finally {
      setSaving(false);
    }
  };

  const removeBookmark = async (id: string) => {
    setError("");
    try {
      await apiSend(`/api/texts/${textId}/marcadores/${id}`, "DELETE");
      setBookmarks((current) => current?.filter((item) => item.id !== id) ?? null);
    } catch {
      setError("Nao consegui apagar o marcador.");
    }
  };

  const snippet = (start: number) => {
    const from = Math.max(0, start - 4);
    return `${from > 0 ? "... " : ""}${words.slice(from, start + 8).join(" ")} ...`;
  };

  return (
    <Sheet open={open} onClose={onClose} title="Navegar no texto">
      <div className="space-y-6">
        {error ? <Alert>{error}</Alert> : null}

        <section className="space-y-2" aria-label="Buscar no texto">
          <label className="block text-sm font-medium text-muted" htmlFor="busca-texto">
            Buscar no texto
          </label>
          <input
            id="busca-texto"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (results.length > 0) goToResult(selected);
              }
            }}
            placeholder="Palavra ou expressao"
            autoComplete="off"
            className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-base"
          />

          {query.trim().length >= 2 ? (
            results.length === 0 ? (
              <p className="text-sm text-muted" aria-live="polite">
                Nada encontrado
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="tabular text-sm text-muted" aria-live="polite" data-testid="busca-contagem">
                    {`${selected + 1} de ${results.length}${results.length >= MAX_SEARCH_RESULTS ? "+" : ""}`}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => step(-1)}>
                      Anterior
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => step(1)}>
                      Proximo
                    </Button>
                  </div>
                </div>
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {results.slice(0, 50).map((start, position) => (
                    <li key={start}>
                      <button
                        type="button"
                        onClick={() => {
                          goToResult(position);
                          onClose();
                        }}
                        aria-current={position === selected ? "true" : undefined}
                        className={`w-full rounded-lg px-2 py-2 text-left text-sm ${
                          position === selected ? "bg-accent-soft" : "hover:bg-surface-2"
                        }`}
                      >
                        {snippet(start)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}
        </section>

        {headings.length > 0 ? (
          <section className="space-y-2" aria-label="Sumario">
            <h3 className="text-sm font-medium text-muted">Sumario</h3>
            <ul className="max-h-60 space-y-1 overflow-y-auto">
              {headings.map((heading, position) => (
                <li key={heading.start} style={{ paddingLeft: `${(heading.level - 1) * 1}rem` }}>
                  <button
                    type="button"
                    onClick={() => {
                      onGo(heading.start);
                      onClose();
                    }}
                    aria-current={position === section ? "location" : undefined}
                    className={`w-full rounded-lg px-2 py-2 text-left text-sm ${
                      position === section ? "bg-accent-soft font-medium" : "hover:bg-surface-2"
                    }`}
                  >
                    {heading.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="space-y-2" aria-label="Marcadores">
          <h3 className="text-sm font-medium text-muted">Marcadores</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={label}
              maxLength={MAX_BOOKMARK_LABEL}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={bookmarkLabel(words, index)}
              aria-label="Nome do marcador"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-base"
            />
            <Button onClick={() => void addBookmark()} loading={saving}>
              <BookmarkIcon className="size-5" />
              Marcar
            </Button>
          </div>

          {bookmarks === null ? null : bookmarks.length === 0 ? (
            <p className="text-sm text-faint">Nenhum marcador neste texto.</p>
          ) : (
            <ul className="space-y-1">
              {bookmarks.map((bookmark) => {
                const outside = bookmark.position >= words.length;
                return (
                  <li key={bookmark.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={outside}
                      onClick={() => {
                        onGo(bookmark.position);
                        onClose();
                      }}
                      className="min-h-11 flex-1 rounded-lg px-2 text-left text-sm hover:bg-surface-2 disabled:opacity-60"
                    >
                      <span className="font-medium">{bookmark.label}</span>
                      <span className="block text-xs text-muted">
                        {outside ? "Fora do texto" : `Palavra ${bookmark.position + 1}`}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeBookmark(bookmark.id)}
                      aria-label={`Apagar marcador ${bookmark.label}`}
                      className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2"
                    >
                      <TrashIcon className="size-5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  );
}
