"use client";

import Link from "next/link";
import { useState } from "react";
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
  Sheet,
  Skeleton,
  TextArea,
} from "@/components/ui";
import { EditIcon, LibraryIcon, TrashIcon } from "@/components/icons";
import { estimatedMinutes, formatNumber } from "@/lib/reading";
import type { Paginated, TextDetail, TextSummary } from "@/lib/types";

export default function TextsPage() {
  const { settings } = useSettings();
  const notify = useToast();
  const [page, setPage] = useState(1);
  const resource = useResource<{ texts: TextSummary[] } & Paginated>(`/api/texts?page=${page}`);
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

      <ImportCard onImported={() => resource.reload()} />

      {resource.loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24 w-full rounded-card" />
          ))}
        </div>
      ) : texts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<LibraryIcon className="size-7" />}
            title="Nada por aqui ainda"
            description="Importe um artigo pelo link acima ou cole um texto seu."
            action={<LinkButton href="/textos/novo">Adicionar texto</LinkButton>}
          />
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
}: {
  text: TextSummary;
  wpm: number;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
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
