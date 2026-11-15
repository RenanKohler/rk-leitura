"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiSend } from "@/lib/client";
import { Alert, Button, Sheet, Slider } from "@/components/ui";
import { BookmarkIcon, TrashIcon } from "@/components/icons";
import { NamesPanel } from "@/components/names-panel";
import {
  bookmarkLabel,
  chapterStateLabel,
  chapterWindow,
  currentHeading,
  MAX_BOOKMARK_LABEL,
  MAX_SEARCH_RESULTS,
  percentAt,
  positionAtPercent,
  remainingLabel,
  searchWords,
  type Heading,
} from "@/lib/navigation";
import type { Paragraph } from "@/lib/reading";
import { canSuggestSections, navigationHeadings, type Section } from "@/lib/sections";
import type { SeriesChapter } from "@/lib/types";
import { SectionsReview } from "@/components/sections-review";
import { useAiConsent } from "@/components/ai-consent";
import { GuideOption } from "@/components/guide-questions";

interface Bookmark {
  id: string;
  position: number;
  label: string;
}

/** Texto solto: a mesma lista vazia a cada render. */
const NO_CHAPTERS: SeriesChapter[] = [];

/**
 * Navegar dentro do texto aberto: buscar (US-90), ir para uma porcentagem
 * (US-227), ir por titulo (US-89) e marcar posicoes para voltar (US-92). Em
 * texto de serie, tambem trocar de capitulo (US-226).
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
  chapters = NO_CHAPTERS,
  timeline,
}: {
  open: boolean;
  onClose: () => void;
  textId: string;
  words: string[];
  paragraphs: Paragraph[];
  index: number;
  onGo: (position: number) => void;
  /** Capitulos da serie do texto, em ordem; vazio em texto solto (US-226). */
  chapters?: SeriesChapter[];
  /**
   * Tempo acumulado ate cada palavra no ritmo atual, com `words.length + 1`
   * entradas: o mesmo relogio do "faltam" do cabecalho. Sem ele, "Ir para"
   * nao diz quanto falta a partir do destino.
   */
  timeline?: Float64Array;
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

        <PercentJump
          paragraphs={paragraphs}
          total={words.length}
          index={index}
          headings={headings}
          timeline={timeline}
          onGo={(position) => {
            onGo(position);
            onClose();
          }}
        />

        {/* Um capitulo so nao tem para onde trocar: a lista diria o que o
            titulo do leitor ja diz. */}
        {chapters.length > 1 ? (
          <ChapterList chapters={chapters} textId={textId} index={index} total={words.length} />
        ) : null}

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

        <GuideOption hasSections={headings.length > 0} />

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

/**
 * "Ir para" uma porcentagem do texto (US-227): o caminho para uma posicao
 * livre, que em texto sem titulos so existia por busca ou marcador.
 *
 * Componente proprio, e nao estado da folha: o conteudo da folha so monta
 * quando ela abre, entao o controle nasce de novo a cada abertura, ja no
 * progresso atual, sem efeito para acertar o valor.
 */
function PercentJump({
  paragraphs,
  total,
  index,
  headings,
  timeline,
  onGo,
}: {
  paragraphs: Paragraph[];
  total: number;
  index: number;
  headings: Heading[];
  timeline?: Float64Array;
  onGo: (position: number) => void;
}) {
  // Nulo ate o leitor mexer no controle: ate la ele mostra onde a leitura
  // esta, inclusive quando a busca muda a posicao com a folha aberta.
  const [chosen, setChosen] = useState<number | null>(null);
  const percent = chosen ?? percentAt(index, total);
  // O destino e o comeco de um paragrafo: o titulo e o tempo sao os dele, e
  // nao os da porcentagem exata.
  const target = positionAtPercent(paragraphs, total, percent);
  const heading = headings[currentHeading(headings, target)];
  const leftMs =
    timeline && timeline.length > total ? timeline[total]! - timeline[target]! : null;

  return (
    <section className="space-y-2" aria-label="Ir para uma porcentagem">
      <Slider
        label="Ir para"
        value={percent}
        display={`${percent}%`}
        min={0}
        max={100}
        step={1}
        onChange={setChosen}
      >
        {/* Uma linha so, sempre presente: o botao de baixo nao sobe nem desce
            enquanto o dedo arrasta. O tempo fica inteiro; o titulo e que corta. */}
        <p
          className="flex min-h-5 items-baseline justify-between gap-3 text-sm text-on-surface-variant"
          aria-live="polite"
          data-testid="ir-para-destino"
        >
          {heading ? <span className="min-w-0 truncate">{heading.title}</span> : null}
          {leftMs !== null ? (
            <span className="tabular shrink-0">{`faltam ${remainingLabel(leftMs)}`}</span>
          ) : null}
        </p>
      </Slider>
      {/* 48px: e a acao do controle, tocada com o polegar logo depois do arraste. */}
      <Button full className="min-h-12!" onClick={() => onGo(target)}>
        {`Ir para ${percent}%`}
      </Button>
    </section>
  );
}

/**
 * Capitulos da serie (US-226): trocar de capitulo sem voltar a biblioteca.
 *
 * O aberto vem marcado e nao e link; os outros levam ao leitor do capitulo,
 * e o leitor grava a posicao deste ao desmontar. Serie longa mostra so a
 * vizinhanca do capitulo aberto; "Mostrar todos" abre a lista inteira numa
 * caixa com rolagem propria, para o sumario e os marcadores continuarem
 * perto.
 */
function ChapterList({
  chapters,
  textId,
  index,
  total,
}: {
  chapters: SeriesChapter[];
  textId: string;
  /** Posicao e tamanho do capitulo aberto, como o leitor os tem agora. */
  index: number;
  total: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const openRef = useRef<HTMLDivElement>(null);
  const visible = chapterWindow(
    chapters.length,
    chapters.findIndex((chapter) => chapter.id === textId)
  );
  const collapsible = visible.to - visible.from < chapters.length;
  const shown = showAll ? chapters : chapters.slice(visible.from, visible.to);

  // A lista inteira abre com o capitulo aberto no meio da caixa: num livro
  // de quarenta, comecar no capitulo 1 obrigaria a rolar ate achar o lugar.
  useEffect(() => {
    if (!showAll) return;
    const list = listRef.current;
    const row = openRef.current;
    if (!list || !row) return;
    const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    list.scrollTop = top - (list.clientHeight - row.offsetHeight) / 2;
  }, [showAll]);

  return (
    <section className="space-y-2" aria-label="Capítulos">
      <h3 className="text-sm font-medium text-muted">Capítulos</h3>
      <ul
        ref={listRef}
        className={`space-y-1 ${showAll ? "max-h-80 overflow-y-auto" : ""}`}
        data-testid="capitulos"
      >
        {shown.map((chapter) => {
          const isOpen = chapter.id === textId;
          // O aberto mostra a posicao desta leitura; a gravada e de quando a
          // tela carregou.
          const state = chapterStateLabel(
            isOpen ? { ...chapter, progressIndex: index, wordCount: total } : chapter
          );
          // Na linha marcada tudo herda a cor do recipiente; nas outras, numero
          // e estado ficam um tom abaixo do titulo.
          const quiet = isOpen ? "" : "text-on-surface-variant";
          const row = (
            <>
              {chapter.chapter !== null ? (
                <span className={`tabular min-w-5 shrink-0 text-right text-sm ${quiet}`}>
                  <span className="sr-only">Capítulo </span>
                  {chapter.chapter}
                </span>
              ) : null}
              <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug">
                {chapter.title}
                {isOpen ? <span className="sr-only"> (aberto)</span> : null}
              </span>
              <span className={`tabular shrink-0 text-xs ${quiet}`} data-testid="estado-do-capitulo">
                {state}
              </span>
            </>
          );
          return (
            // 48px por linha: cada uma e um alvo de toque no celular.
            <li key={chapter.id}>
              {isOpen ? (
                <div
                  ref={openRef}
                  aria-current="page"
                  className="flex min-h-12 items-center gap-3 rounded-lg bg-secondary-container px-3 py-1.5 font-medium text-on-secondary-container"
                >
                  {row}
                </div>
              ) : (
                // Sem busca antecipada: sao tantos enderecos quantos capitulos,
                // e cada um e um texto inteiro.
                <Link
                  href={`/leitor/${chapter.id}`}
                  prefetch={false}
                  className="state-layer flex min-h-12 items-center gap-3 rounded-lg px-3 py-1.5"
                >
                  {row}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {collapsible ? (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
          className="state-layer flex min-h-12 w-full items-center rounded-lg px-3 text-left text-sm font-medium text-primary"
        >
          {showAll ? "Mostrar menos" : `Mostrar todos os ${chapters.length} capítulos`}
        </button>
      ) : null}
    </section>
  );
}
