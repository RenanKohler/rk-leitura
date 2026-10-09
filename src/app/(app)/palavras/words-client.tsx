"use client";

import { useState } from "react";
import Link from "next/link";
import { apiSend, consentFrom } from "@/lib/client";
import { AiConsentNotice, AiOffNotice } from "@/components/ai-consent";
import { useToast } from "@/components/providers";
import {
  Button,
  buttonClasses,
  Card,
  EmptyState,
  Field,
  LinkButton,
  Segmented,
} from "@/components/ui";
import {
  BackIcon,
  CheckIcon,
  DownloadIcon,
  RestoreIcon,
  TrashIcon,
  WordsIcon,
} from "@/components/icons";
import { isPendingDefinition, type BatchState } from "@/lib/definition-batch";
import { foldForSearch } from "@/lib/text-filter";
import { formatRelativeDay } from "@/lib/reading";
import type { RetentionSummary, SavedWordItem } from "@/lib/types";

type Filter = "todas" | "aprendidas" | "pendentes";

/**
 * Palavras consultadas durante a leitura.
 *
 * A lista e a razao de a consulta ser guardada: uma palavra que interrompeu a
 * leitura uma vez costuma interromper de novo, e revisitar a lista e o que
 * transforma a interrupcao em aprendizado.
 */
export function WordsClient({
  initial,
  retention,
  batch: initialBatch = { processing: false, wordIds: [] },
}: {
  initial: SavedWordItem[];
  /** Retencao das revisoes nos ultimos 30 dias (PROD-7). */
  retention?: RetentionSummary;
  /** Lote de definicoes em andamento (US-139). */
  batch?: BatchState;
}) {
  const notify = useToast();
  const [items, setItems] = useState(initial);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("todas");
  // Lote de definicoes pendentes (US-139): um por conta, conferido no servidor.
  const [batch, setBatch] = useState(initialBatch);
  const [batchNote, setBatchNote] = useState("");
  const [consent, setConsent] = useState<"pending" | "off" | null>(null);
  // Definicao em edicao (PROD-6): so uma por vez, com o rascunho a parte.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const saveDefinition = async (id: string) => {
    setBusy(true);
    try {
      const { definition } = await apiSend<{ definition: string }>(`/api/palavras/${id}`, "PATCH", {
        definition: draft,
      });
      setItems((current) => current.map((item) => (item.id === id ? { ...item, definition } : item)));
      setEditing(null);
    } catch {
      notify("Não consegui salvar a definição.", "error");
    } finally {
      setBusy(false);
    }
  };

  const refetchDefinition = async (id: string) => {
    setBusy(true);
    try {
      const { entry } = await apiSend<{
        entry: { definition: string; base: string; kind: string; translation?: string | null };
      }>(`/api/palavras/${id}/definicao`, "POST");
      setItems((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                definition: entry.definition,
                base: entry.base,
                kind: entry.kind,
                translation: entry.translation ?? null,
              }
            : item
        )
      );
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Não consegui buscar a definição.", "error");
    } finally {
      setBusy(false);
    }
  };

  const startBatch = async () => {
    setBusy(true);
    setBatchNote("");
    try {
      const data = await apiSend<{ wordIds: string[]; message: string }>(
        "/api/palavras/definicoes",
        "POST"
      );
      setBatch({ processing: true, wordIds: data.wordIds });
      setBatchNote(data.message);
      setConsent(null);
    } catch (cause) {
      const state = consentFrom(cause);
      if (state) {
        setConsent(state);
        return;
      }
      notify(cause instanceof Error ? cause.message : "Não consegui enviar o lote.", "error");
    } finally {
      setBusy(false);
    }
  };

  /** Marca ou desmarca como aprendida (US-66); desfaz na tela se falhar. */
  const setLearned = async (id: string, learned: boolean) => {
    const before = items;
    setBusy(true);
    setItems(before.map((item) => (item.id === id ? { ...item, learned } : item)));
    try {
      await apiSend(`/api/palavras/${id}`, "PATCH", { learned });
      notify(learned ? "Marcada como aprendida." : "De volta à revisão.", "success");
    } catch {
      setItems(before);
      notify("Não consegui salvar.", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const before = items;
    setBusy(true);
    setItems(before.filter((item) => item.id !== id));
    try {
      await apiSend(`/api/dicionario?id=${id}`, "DELETE");
    } catch {
      setItems(before);
      notify("Não consegui remover.", "error");
    } finally {
      setBusy(false);
    }
  };

  const searching = new Set(batch.processing ? batch.wordIds : []);
  const pending = items.filter((item) => isPendingDefinition(item.definition));
  // So as que o lote nao esta buscando contam para um lote novo.
  const waiting = pending.filter((item) => !searching.has(item.id));

  // A lista de pendentes esvaziou: volta a mostrar todas.
  const view = filter === "pendentes" && pending.length === 0 ? "todas" : filter;

  const term = foldForSearch(query);
  const scoped =
    view === "aprendidas"
      ? items.filter((item) => item.learned)
      : view === "pendentes"
        ? pending
        : items;
  const shown = term
    ? scoped.filter(
        (item) =>
          foldForSearch(item.word).includes(term) ||
          foldForSearch(item.base).includes(term) ||
          foldForSearch(item.definition).includes(term)
      )
    : scoped;

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-2 pt-2">
        <Link
          href="/ajustes"
          aria-label="Voltar"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        >
          <BackIcon className="size-5" />
        </Link>
        <div className="flex-1 pt-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Palavras salvas</h1>
          <p className="mt-1 text-sm text-muted">
            {items.length === 0
              ? "Nenhuma ainda"
              : `${items.length} ${items.length === 1 ? "palavra" : "palavras"} consultadas`}
          </p>
          {retention && retention.percent !== null ? (
            <p className="mt-0.5 text-sm text-muted" data-testid="retencao">
              {`Retenção em 30 dias: ${retention.percent}% de ${retention.answers} ${
                retention.answers === 1 ? "resposta" : "respostas"
              }`}
            </p>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <LinkButton href="/palavras/revisar" variant="primary">
          Revisar
        </LinkButton>
        {/* Exportar e um download comum: o navegador cuida do arquivo. Sem
            palavras, o botao fica desabilitado em vez de baixar so o
            cabecalho. */}
        {items.length > 0 ? (
          <a
            href="/api/palavras/exportar"
            download
            className={buttonClasses("secondary")}
          >
            <DownloadIcon className="size-5" />
            Exportar
          </a>
        ) : (
          <Button variant="secondary" disabled>
            <DownloadIcon className="size-5" />
            Exportar
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<WordsIcon className="size-7" />}
            title="Nenhuma palavra salva"
            description="Durante a leitura, toque e segure em uma palavra para ver o significado. Ela fica guardada aqui."
            action={<LinkButton href="/textos">Ir para a biblioteca</LinkButton>}
          />
        </Card>
      ) : (
        <>
          {pending.length >= 2 || batch.processing ? (
            <Card className="space-y-2 p-4" data-testid="lote-definicoes">
              {consent === "pending" ? (
                <AiConsentNotice
                  onDecided={(allowed) => {
                    setConsent(allowed ? null : "off");
                    if (allowed) void startBatch();
                  }}
                />
              ) : (
                <>
                  <Button
                    variant="secondary"
                    full
                    loading={busy && !batch.processing}
                    disabled={busy || batch.processing || waiting.length === 0}
                    onClick={() => void startBatch()}
                  >
                    {batch.processing
                      ? "Buscando definições…"
                      : `Buscar definições pendentes (${waiting.length})`}
                  </Button>
                  <p className="text-sm text-muted" role="status">
                    {batch.processing
                      ? `${batchNote ? `${batchNote} ` : ""}As definições aparecem aqui quando o lote terminar, em alguns minutos ou até 24 horas. Um lote por vez.`
                      : "Busca todas de uma vez, em segundo plano, com a frase em que cada uma apareceu."}
                  </p>
                  {consent === "off" ? <AiOffNotice /> : null}
                </>
              )}
            </Card>
          ) : null}

          <Segmented<Filter>
            label="Filtrar palavras"
            value={view}
            onChange={setFilter}
            options={[
              { value: "todas", label: "Todas" },
              { value: "aprendidas", label: "Aprendidas" },
              ...(pending.length > 0
                ? [{ value: "pendentes" as const, label: `Pendentes (${pending.length})` }]
                : []),
            ]}
          />

          {items.length > 5 ? (
            <Field
              label="Buscar"
              name="busca-palavra"
              type="search"
              placeholder="Palavra ou significado"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}

          <ul className="space-y-2">
            {shown.map((item, position) => (
              <li
                key={item.id}
                className="animate-rise"
                style={{ animationDelay: `${Math.min(position, 8) * 40}ms` }}
              >
                <Card className="p-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-snug">{item.base}</p>
                      {item.kind || item.learned ? (
                        <p className="text-xs text-faint">
                          {[item.kind, item.learned ? "aprendida" : ""].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={
                        item.learned
                          ? `Devolver ${item.base} a revisão`
                          : `Marcar ${item.base} como aprendida`
                      }
                      aria-pressed={item.learned}
                      onClick={() => void setLearned(item.id, !item.learned)}
                    >
                      {item.learned ? (
                        <RestoreIcon className="size-4" />
                      ) : (
                        <CheckIcon className="size-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={`Remover ${item.base}`}
                      onClick={() => void remove(item.id)}
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  </div>

                  {item.translation ? (
                    <p className="mt-1.5 text-sm font-medium">{item.translation}</p>
                  ) : null}
                  {editing === item.id ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        aria-label={`Definição de ${item.base}`}
                        className="min-h-20 w-full rounded-2xl border border-border bg-bg p-3 text-sm"
                        maxLength={500}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" disabled={busy} onClick={() => void saveDefinition(item.id)}>
                          Salvar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : item.definition.trim() ? (
                    <p className="mt-1.5 text-sm leading-relaxed">{item.definition}</p>
                  ) : (
                    // Guardada sem consulta (PROD-6): a frase ajuda a lembrar
                    // enquanto a definicao nao vem.
                    <div className="mt-1.5 space-y-1.5">
                      {item.context ? (
                        <p className="text-sm leading-relaxed text-muted">&ldquo;{item.context}&rdquo;</p>
                      ) : null}
                      {searching.has(item.id) ? (
                        <p className="text-sm italic text-faint" data-testid="buscando">
                          Buscando
                        </p>
                      ) : (
                        <>
                          <p className="text-sm italic text-faint">sem definição</p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busy}
                              onClick={() => void refetchDefinition(item.id)}
                            >
                              Buscar definição
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => {
                                setDraft("");
                                setEditing(item.id);
                              }}
                            >
                              Escrever
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <p className="mt-2 text-xs text-faint">
                    {item.textTitle ? (
                      <>
                        em{" "}
                        <Link href={`/leitor/${item.textId}`} className="text-muted underline">
                          {item.textTitle}
                        </Link>
                        {" · "}
                      </>
                    ) : null}
                    {formatRelativeDay(item.createdAt)}
                  </p>
                </Card>
              </li>
            ))}
          </ul>

          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nenhuma palavra corresponde.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
