"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiSend } from "@/lib/client";
import { Alert, Button, Sheet } from "@/components/ui";
import { BookmarkIcon, TrashIcon } from "@/components/icons";
import { NamesPanel } from "@/components/names-panel";
import {
  bookmarkLabel,
  currentHeading,
  MAX_BOOKMARK_LABEL,
  MAX_SEARCH_RESULTS,
  searchWords,
} from "@/lib/navigation";
import type { Paragraph } from "@/lib/reading";
import { canSuggestSections, navigationHeadings, type Section } from "@/lib/sections";
import { SectionsReview } from "@/components/sections-review";
import { useAiConsent } from "@/components/ai-consent";

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
  const searchRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState(0);
  const results = useMemo(() => searchWords(words, query), [words, query]);
  // Secoes aplicadas (US-153): entram no sumario so quando o texto nao tem
  // titulos proprios.
  const [sections, setSections] = useState<Section[]>([]);
  const headings = useMemo(() => navigationHeadings(paragraphs, sections), [paragraphs, sections]);
  const section = currentHeading(headings, index);
  const sectionable = useMemo(
    () => canSuggestSections(words.length, paragraphs),
    [words.length, paragraphs]
  );
  const { state: consent } = useAiConsent();
  // Com a IA desligada, so as secoes ja aplicadas aparecem.
  const offerSections = sectionable && (consent !== "off" || sections.length > 0);

  const [bookmarks, setBookmarks] = useState<Bookmark[] | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showNames, setShowNames] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void apiGet<{ bookmarks: Bookmark[] }>(`/api/texts/${textId}/marcadores`)
      .then((data) => {
        if (active) setBookmarks(data.bookmarks);
      })
      .catch(() => {
        if (active) setError("Não consegui carregar os marcadores.");
      });
    return () => {
      active = false;
    };
  }, [open, textId]);

  useEffect(() => {
    // Texto com titulos proprios nunca usa secoes: nem pergunta.
    if (!open || !sectionable) return;
    let active = true;
    void apiGet<{ sections: Section[] }>(`/api/texts/${textId}/secoes`)
      .then((data) => {
        if (active) setSections(data.sections);
      })
      .catch(() => {
        // Sem as secoes o sumario fica como antes.
      });
    return () => {
      active = false;
    };
  }, [open, textId, sectionable]);

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
      setError(cause instanceof Error ? cause.message : "Não consegui criar o marcador.");
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
      setError("Não consegui apagar o marcador.");
    }
  };

  const snippet = (start: number) => {
    const from = Math.max(0, start - 4);
    return `${from > 0 ? "... " : ""}${words.slice(from, start + 8).join(" ")} ...`;
  };

  return (
    // A folha abre para buscar: o foco vai direto ao campo (A11Y-13).
    <Sheet open={open} onClose={onClose} title="Navegar no texto" initialFocus={searchRef}>
      <div className="space-y-6">
        {error ? <Alert>{error}</Alert> : null}

        <section className="space-y-2" aria-label="Buscar no texto">
          <label className="block text-sm font-medium text-muted" htmlFor="busca-texto">
            Buscar no texto
          </label>
          <input
            id="busca-texto"
            ref={searchRef}
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
            placeholder="Palavra ou expressão"
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
                    <Button variant="secondary" className="min-w-11" onClick={() => step(-1)}>
                      Anterior
                    </Button>
                    <Button variant="secondary" className="min-w-11" onClick={() => step(1)}>
                      Próximo
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
                        className={`min-h-11 w-full rounded-lg px-2 py-2 text-left text-sm ${
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

        {headings.length > 0 || offerSections ? (
          <section className="space-y-2" aria-label="Sumário">
            <h3 className="text-sm font-medium text-muted">Sumário</h3>
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
            {offerSections ? (
              <SectionsReview
                textId={textId}
                words={words}
                current={sections}
                onApplied={setSections}
              />
            ) : null}
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

        {/* Nomes do texto (PROD-11). Calculado so quando aberto: varre o texto
            inteiro, e a maioria das consultas a folha e busca ou marcador. */}
        <section className="space-y-2" aria-label="Nomes">
          <button
            type="button"
            aria-expanded={showNames}
            onClick={() => setShowNames((value) => !value)}
            className="flex min-h-11 w-full items-center justify-between rounded-lg px-2 text-left text-sm font-medium text-muted hover:bg-surface-2"
          >
            Nomes no texto
            <span aria-hidden="true">{showNames ? "\u2212" : "+"}</span>
          </button>
          {showNames ? (
            <NamesPanel
              textId={textId}
              position={index}
              words={words}
              paragraphs={paragraphs}
              onGo={(position) => {
                onGo(position);
                onClose();
              }}
            />
          ) : null}
        </section>

        {/* Cartoes, glossario e o resto do estudo do texto (US-155 a US-170). */}
        <Link
          href={`/textos/${textId}/estudar`}
          className="flex min-h-11 w-full items-center rounded-lg px-2 text-sm font-medium text-muted hover:bg-surface-2"
        >
          Estudar este texto
        </Link>
      </div>
    </Sheet>
  );
}
