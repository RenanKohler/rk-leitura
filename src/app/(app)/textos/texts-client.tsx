"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useResource } from "@/hooks/use-resource";
import { apiGet, apiSend } from "@/lib/client";
import { useSettings, useToast } from "@/components/providers";
import { ImportCard } from "@/components/import-card";
import {
  Button,
  Card,
  EmptyState,
  Field,
  LinkButton,
  Pagination,
  Segmented,
  Sheet,
  Skeleton,
  TextArea,
} from "@/components/ui";
import { ArchiveIcon, EditIcon, LibraryIcon, RestoreIcon, TrashIcon } from "@/components/icons";
import { estimatedMinutes, formatNumber } from "@/lib/reading";
import {
  DEFAULT_SCOPE,
  DEFAULT_STATUS,
  MAX_QUERY_CHARS,
  type TextScope,
  type TextStatus,
} from "@/lib/text-filter";
import type { Paginated, TextDetail, TextSummary } from "@/lib/types";

const STATUS_OPTIONS: { value: TextStatus; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "nao-iniciados", label: "Nao lidos" },
  { value: "em-andamento", label: "Lendo" },
  { value: "concluidos", label: "Lidos" },
];

const SCOPE_OPTIONS: { value: TextScope; label: string }[] = [
  { value: "ativos", label: "Meus textos" },
  { value: "arquivados", label: "Arquivados" },
];

/** Espera entre a ultima tecla e a busca, para nao consultar a cada letra. */
const DEBOUNCE_MS = 300;

export type TextsPage = { texts: TextSummary[] } & Paginated;

export function TextsClient({ initial }: { initial: TextsPage }) {
  const { settings } = useSettings();
  const notify = useToast();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TextStatus>(DEFAULT_STATUS);
  const [scope, setScope] = useState<TextScope>(DEFAULT_SCOPE);

  // O termo so chega a consulta depois que a digitacao para.
  const [searched, setSearched] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const filtering = searched.length > 0 || status !== DEFAULT_STATUS;
  const archived = scope === "arquivados";
  const path =
    `/api/texts?page=${page}&status=${status}&scope=${scope}` +
    (searched ? `&q=${encodeURIComponent(searched)}` : "");

  // A primeira pagina da lista principal sem filtro ja veio no HTML.
  const resource = useResource<TextsPage>(
    path,
    page === 1 && !filtering && !archived ? initial : undefined
  );

  const changeFilter = (apply: () => void) => {
    apply();
    // Sem isto, filtrar estando na pagina 3 cairia em uma lista vazia que
    // parece "nada encontrado" mas e so pagina fora do intervalo.
    setPage(1);
  };

  const clearFilters = () =>
    changeFilter(() => {
      setQuery("");
      setSearched("");
      setStatus(DEFAULT_STATUS);
    });

  const toggleArchive = async (text: TextSummary) => {
    const restoring = text.archivedAt !== null;
    try {
      await apiSend(`/api/texts/${text.id}/arquivo`, restoring ? "DELETE" : "POST");
      notify(restoring ? "Texto de volta a biblioteca." : "Texto arquivado.", "success");
      resource.reload();
    } catch {
      notify(restoring ? "Falha ao desarquivar." : "Falha ao arquivar.", "error");
    }
  };
  const [editing, setEditing] = useState<TextDetail | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TextSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const texts = resource.data?.texts ?? [];
  const total = resource.data?.total ?? texts.length;
  const pageCount = resource.data?.pageCount ?? 1;

  const openEditor = async (text: TextSummary) => {
    try {
      // A listagem nao traz o conteudo; busca so ao abrir o editor.
      const { text: detail } = await apiGet<{ text: TextDetail }>(`/api/texts/${text.id}`);
      setEditing(detail);
    } catch {
      notify("Nao foi possivel abrir o texto.", "error");
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await apiSend(`/api/texts/${editing.id}`, "PUT", {
        title: editing.title,
        sourceUrl: editing.sourceUrl,
        content: editing.content,
      });
      setEditing(null);
      resource.reload();
      notify("Texto atualizado.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao salvar.", "error");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await apiSend(`/api/texts/${pendingDelete.id}`, "DELETE");
      setPendingDelete(null);
      notify("Texto removido.", "success");
      // Recarrega em vez de filtrar no cliente: a contagem total e o numero de
      // paginas mudaram, e a pagina atual pode ter ficado vazia.
      if (texts.length === 1 && page > 1) setPage(page - 1);
      else resource.reload();
    } catch {
      notify("Falha ao remover.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meus textos</h1>
          <p className="mt-1 text-sm text-muted">
            {resource.loading
              ? "Carregando"
              : filtering
                ? `${total} ${total === 1 ? "resultado" : "resultados"}`
                : `${total} ${total === 1 ? "texto" : "textos"} na biblioteca`}
          </p>
        </div>
        {/* No celular o botao flutuante da barra inferior ja cobre esta acao. */}
        <span className="hidden sm:block">
          <LinkButton href="/textos/novo" variant="secondary">
            Adicionar
          </LinkButton>
        </span>
      </header>

      {/* Arquivar nao e um filtro somado aos outros: um texto esta na lista
          principal ou fora dela. Por isso aba, e nao mais uma opcao ao lado
          de "Lidos". */}
      <Segmented<TextScope>
        label="Aba da biblioteca"
        value={scope}
        onChange={(value) => changeFilter(() => setScope(value))}
        options={SCOPE_OPTIONS}
      />

      {archived ? null : <ImportCard onImported={() => resource.reload()} />}

      <div className="space-y-3">
        <Field
          label="Buscar"
          name="busca"
          type="search"
          inputMode="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={MAX_QUERY_CHARS}
          placeholder="Titulo do texto"
          value={query}
          onChange={(event) => changeFilter(() => setQuery(event.target.value))}
        />
        <Segmented<TextStatus>
          label="Filtrar por leitura"
          value={status}
          onChange={(value) => changeFilter(() => setStatus(value))}
          options={STATUS_OPTIONS}
        />
      </div>

      {resource.loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24 w-full rounded-card" />
          ))}
        </div>
      ) : texts.length === 0 ? (
        <Card>
          {archived && !filtering ? (
            <EmptyState
              icon={<ArchiveIcon className="size-7" />}
              title="Nada arquivado"
              description="Textos concluidos vem parar aqui, e o historico de leitura deles continua contando."
            />
          ) : filtering ? (
            <EmptyState
              icon={<LibraryIcon className="size-7" />}
              title="Nenhum texto encontrado"
              description="Nada na biblioteca corresponde a busca e ao filtro escolhidos."
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<LibraryIcon className="size-7" />}
              title="Nada por aqui ainda"
              description="Importe um artigo pelo link acima ou cole um texto seu."
              action={<LinkButton href="/textos/novo">Adicionar texto</LinkButton>}
            />
          )}
        </Card>
      ) : (
        <>
          <ul className="space-y-2">
            {texts.map((text, index) => (
              <TextCard
                key={text.id}
                text={text}
                wpm={settings.baseWpm}
                index={index}
                onEdit={() => openEditor(text)}
                onDelete={() => setPendingDelete(text)}
                onToggleArchive={() => void toggleArchive(text)}
              />
            ))}
          </ul>
          <Pagination
            page={resource.data?.page ?? page}
            pageCount={pageCount}
            busy={resource.loading}
            onChange={(next) => {
              setPage(next);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </>
      )}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Editar texto"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" full onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button full loading={busy} onClick={saveEdit}>
              Salvar
            </Button>
          </div>
        }
      >
        {editing ? (
          <div className="space-y-4">
            <Field
              label="Titulo"
              name="title"
              value={editing.title}
              onChange={(event) => setEditing({ ...editing, title: event.target.value })}
            />
            <Field
              label="Link de origem"
              name="sourceUrl"
              type="url"
              inputMode="url"
              placeholder="Opcional"
              value={editing.sourceUrl ?? ""}
              onChange={(event) => setEditing({ ...editing, sourceUrl: event.target.value })}
            />
            <TextArea
              label="Conteudo"
              name="content"
              rows={12}
              value={editing.content}
              onChange={(event) => setEditing({ ...editing, content: event.target.value })}
            />
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Remover texto"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" full onClick={() => setPendingDelete(null)}>
              Cancelar
            </Button>
            <Button variant="danger" full loading={busy} onClick={confirmDelete}>
              Remover
            </Button>
          </div>
        }
      >
        <p className="text-muted">
          &quot;{pendingDelete?.title}&quot; e todo o historico de leitura dele serao apagados. Essa
          acao nao pode ser desfeita.
        </p>
      </Sheet>
    </div>
  );
}

function TextCard({
  text,
  wpm,
  index,
  onEdit,
  onDelete,
  onToggleArchive,
}: {
  text: TextSummary;
  wpm: number;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  onToggleArchive: () => void;
}) {
  const archived = text.archivedAt !== null;
  const percent =
    text.wordCount > 0 ? Math.round((text.progressIndex / text.wordCount) * 100) : 0;

  return (
    <li className="animate-rise" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Link href={`/leitor/${text.id}`} className="min-w-0 flex-1">
            <p className="font-medium leading-snug">{text.title}</p>
            <p className="mt-1 text-sm text-muted">
              {`${formatNumber(text.wordCount)} palavras · ~${estimatedMinutes(text.wordCount, wpm)} min`}
              {percent > 0 ? ` · ${percent}% lido` : ""}
            </p>
            {text.sourceUrl ? (
              <p className="break-anywhere mt-1 line-clamp-1 text-xs text-faint">{text.sourceUrl}</p>
            ) : null}
          </Link>

          {/* Botoes sempre visiveis: a versao anterior os escondia atras de
              :hover, inalcancavel em tela de toque. */}
          <div className="flex shrink-0 gap-1">
            <IconButton
              label={archived ? "Voltar a biblioteca" : "Arquivar"}
              onClick={onToggleArchive}
            >
              {archived ? <RestoreIcon className="size-5" /> : <ArchiveIcon className="size-5" />}
            </IconButton>
            <IconButton label="Editar" onClick={onEdit}>
              <EditIcon className="size-5" />
            </IconButton>
            <IconButton label="Remover" onClick={onDelete} danger>
              <TrashIcon className="size-5" />
            </IconButton>
          </div>
        </div>

        {percent > 0 ? (
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </Card>
    </li>
  );
}

function IconButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex size-11 items-center justify-center rounded-full transition-colors ${
        danger ? "text-muted hover:bg-danger-soft hover:text-danger" : "text-muted hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
