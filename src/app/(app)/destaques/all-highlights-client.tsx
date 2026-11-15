"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useToast } from "@/components/providers";
import { Button, Card, EmptyState, Field, LinkButton } from "@/components/ui";
import { CheckIcon, DownloadIcon, MarkIcon, SearchIcon } from "@/components/icons";
import { NO_CONNECTION } from "@/lib/client";
import {
  dayLabel,
  filterHighlights,
  foldText,
  groupHighlights,
  HIGHLIGHT_LIBRARY_TITLE,
  HIGHLIGHT_PAGE_SIZE,
  highlightsLabel,
  libraryExportFileName,
  limitGroups,
  matchLabel,
  searchIndex,
  totalLabel,
  truncationNotice,
  type HighlightScope,
} from "@/lib/highlight-library";
import { formatNumber } from "@/lib/reading";
import { MAX_QUERY_CHARS } from "@/lib/text-filter";
import type { HighlightLibrary } from "@/lib/types";

const EXPORT_FAILED = "Não consegui exportar os destaques.";

const SCOPES: { value: HighlightScope; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "com-nota", label: "Com nota" },
];

/**
 * Baixa o arquivo pelo mesmo caminho da exportacao de um texto: um link
 * temporario para o conteudo ja em memoria. E o que funciona no app
 * instalado no Android.
 */
function saveFile(body: string, filename: string) {
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Destaques e notas de todos os textos (US-224).
 *
 * A tela e de consulta: acha, le e leva ao texto. Editar a nota, remover,
 * sintetizar e gerar cartoes continuam na tela de destaques de cada texto,
 * para onde o titulo do grupo leva.
 *
 * A lista inteira ja veio no HTML, entao a busca filtra aqui mesmo, a cada
 * letra, sem ida ao servidor.
 */
export function AllHighlightsClient({
  library,
  due,
  timezone,
}: {
  library: HighlightLibrary;
  /** Destaques vencidos na revisao espacada. */
  due: number;
  /** Fuso do leitor: o dia de cada destaque e o nome do arquivo. */
  timezone: string;
}) {
  const notify = useToast();
  const { items, texts, total } = library;
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<HighlightScope>("todos");
  const [exporting, setExporting] = useState(false);
  // Quantos destaques estao desenhados e para qual busca e filtro. Guardar a
  // vista junto faz a contagem voltar ao comeco quando a busca muda, sem
  // efeito para zerar.
  const [drawn, setDrawn] = useState({ view: "", size: HIGHLIGHT_PAGE_SIZE });

  // Trecho, nota e titulo dobrados uma vez; digitar so compara.
  const index = useMemo(() => searchIndex(items, texts), [items, texts]);

  const needle = foldText(query);
  const searching = needle.length > 0;
  const matched = filterHighlights(index, query, scope);
  const groups = groupHighlights(matched, texts);

  const view = `${scope}\n${needle}`;
  const size = drawn.view === view ? drawn.size : HIGHLIGHT_PAGE_SIZE;
  const visible = limitGroups(groups, size);
  const remaining = Math.max(0, matched.length - size);

  const result = matchLabel(matched.length, searching, scope);
  const cut = truncationNotice(items.length, total);

  const clearFilters = () => {
    setQuery("");
    setScope("todos");
  };

  /**
   * O arquivo vem da rota, e nao desta lista: ele traz todos os destaques,
   * mesmo os que o limite da tela deixou de fora, e os dados de cada texto.
   */
  const exportAll = async () => {
    setExporting(true);
    try {
      const response = await fetch("/api/destaques/exportar", { cache: "no-store" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? EXPORT_FAILED);
      }
      saveFile(await response.text(), libraryExportFileName(timezone));
    } catch (cause) {
      // Sem rede o navegador lanca TypeError com texto em ingles.
      notify(
        cause instanceof TypeError
          ? NO_CONNECTION
          : cause instanceof Error
            ? cause.message
            : EXPORT_FAILED,
        "error"
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="pt-2">
        <h1 className="text-headline-small">{HIGHLIGHT_LIBRARY_TITLE}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3">
          <p className="text-sm text-muted" data-testid="destaques-contagem">
            {items.length === 0
              ? "Trechos marcados e notas de todos os textos"
              : totalLabel(items.length, texts.length)}
          </p>
          {/* O cartao "Revisar destaques" saiu do Inicio: com algum vencido, a
              revisao so de destaques continua alcancavel por aqui. */}
          {due > 0 ? (
            <Link
              href="/textos/destaques/revisar"
              data-testid="revisar-destaques"
              className="state-layer -mx-2 flex min-h-11 items-center rounded-full px-2 text-sm font-medium text-primary"
            >
              {`Revisar destaques (${formatNumber(due)})`}
            </Link>
          ) : null}
        </div>
      </header>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MarkIcon className="size-7" />}
            title="Nenhum destaque ainda"
            description="No leitor, selecione um trecho para marcar, ou toque em Destacar frase para marcar a frase em que a leitura está. Tudo o que você marcar e anotar aparece aqui."
            action={<LinkButton href="/textos">Ir para a biblioteca</LinkButton>}
          />
        </Card>
      ) : (
        <>
          {cut ? (
            <p
              className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted"
              data-testid="destaques-limite"
            >
              {`${cut} A busca procura só nestes; a exportação leva todos.`}
            </p>
          ) : null}

          <Button
            variant="secondary"
            full
            loading={exporting}
            onClick={() => void exportAll()}
          >
            <DownloadIcon className="size-5" />
            Exportar tudo (.md)
          </Button>

          <div className="space-y-3">
            <Field
              label="Buscar"
              name="busca-destaques"
              type="search"
              inputMode="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={MAX_QUERY_CHARS}
              placeholder="Trecho, nota ou título do texto"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />

            <div role="group" aria-label="Filtrar destaques" className="flex flex-wrap gap-1.5">
              {SCOPES.map((option) => (
                <Chip
                  key={option.value}
                  pressed={scope === option.value}
                  onClick={() => setScope(option.value)}
                >
                  {option.label}
                </Chip>
              ))}
            </div>

            {/* Sempre na tela, mesmo vazio: o leitor de tela so anuncia a
                mudanca de uma regiao que ja existia. */}
            <p
              role="status"
              data-testid="destaques-resultado"
              className={result ? "text-sm text-muted" : "sr-only"}
            >
              {result ?? ""}
            </p>
          </div>

          {matched.length === 0 ? (
            <Card>
              <EmptyState
                icon={<SearchIcon className="size-7" />}
                title="Nada encontrado"
                description="Tente outra palavra, ou volte a ver todos os destaques."
                action={
                  <Button variant="secondary" onClick={clearFilters}>
                    Ver todos os destaques
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="space-y-6">
              {visible.map((group) => (
                <section key={group.text.id} data-testid="grupo-destaques">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="min-w-0 flex-1 text-title-medium">
                      {/* Editar a nota, remover, sintese e cartoes ficam la. */}
                      <Link
                        href={`/textos/${group.text.id}/destaques`}
                        className="state-layer -mx-2 flex min-h-12 items-center rounded-lg px-2"
                      >
                        <span className="line-clamp-2">{group.text.title}</span>
                      </Link>
                    </h2>
                    <span className="tabular shrink-0 text-sm text-muted" data-testid="grupo-contagem">
                      {highlightsLabel(group.count)}
                    </span>
                  </div>

                  <ul className="mt-1 space-y-2">
                    {group.items.map((item) => (
                      <li key={item.id} data-testid="destaque">
                        <Card className="px-4 pt-4 pb-2">
                          <blockquote className="border-l-2 border-mark pl-3 text-sm leading-relaxed">
                            {item.excerpt}
                          </blockquote>

                          {item.note ? (
                            <p
                              className="mt-3 whitespace-pre-line rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted"
                              data-testid="destaque-nota"
                            >
                              {item.note}
                            </p>
                          ) : null}

                          <div className="mt-1 flex items-center justify-between gap-2">
                            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
                              <span className="tabular">{dayLabel(item.createdAt, timezone)}</span>
                              {item.reviewOff ? (
                                <span
                                  className="rounded-full bg-surface-2 px-2 py-0.5 font-medium text-muted"
                                  data-testid="fora-da-revisao"
                                >
                                  Fora da revisão
                                </span>
                              ) : null}
                            </p>
                            {/* Sem busca antecipada: sao dezenas de enderecos
                                diferentes na tela, um por destaque. */}
                            <Link
                              href={`/leitor/${item.textId}?de=${item.start}`}
                              prefetch={false}
                              className="state-layer -mr-3 flex min-h-12 shrink-0 items-center rounded-full px-3 text-sm font-medium text-primary"
                            >
                              Ler a partir daqui
                            </Link>
                          </div>
                        </Card>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

              {remaining > 0 ? (
                <Button
                  variant="secondary"
                  full
                  onClick={() => setDrawn({ view, size: size + HIGHLIGHT_PAGE_SIZE })}
                >
                  {`Mostrar mais (${remaining === 1 ? "falta 1" : `faltam ${formatNumber(remaining)}`})`}
                </Button>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Filtro em chip, como os da biblioteca: alterna, e diz se esta ligado. */
function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      // Filter chip do M3: canto de 8px; escolhido, secondary-container.
      className={`state-layer flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-sm font-medium tracking-[0.1px] transition-colors ${
        pressed
          ? "border-transparent bg-secondary-container text-on-secondary-container"
          : "border-outline-variant text-on-surface-variant"
      }`}
    >
      {pressed ? <CheckIcon className="size-3.5" /> : null}
      {children}
    </button>
  );
}
