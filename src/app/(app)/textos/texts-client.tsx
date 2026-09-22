"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useResource } from "@/hooks/use-resource";
import { apiGet, apiSend } from "@/lib/client";
import { useSettings, useToast } from "@/components/providers";
import { ImportCard } from "@/components/import-card";
import { TagPicker } from "@/components/tag-picker";
import { TagManagerSheet } from "@/components/tag-manager-sheet";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  LinkButton,
  Pagination,
  Segmented,
  SelectField,
  Sheet,
  Skeleton,
  TextArea,
} from "@/components/ui";
import { PAUSED_MESSAGE } from "@/lib/follow";
import { LANGUAGES } from "@/lib/language";
import {
  ArchiveIcon,
  EditIcon,
  LibraryIcon,
  ChevronIcon,
  CheckIcon,
  MarkIcon,
  QueueIcon,
  RestoreIcon,
  SeriesIcon,
  TrashIcon,
} from "@/components/icons";
import { estimatedMinutes, formatNumber } from "@/lib/reading";
import { sameTag } from "@/lib/tags";
import { seriesProgress } from "@/lib/series";
import {
  DEFAULT_SCOPE,
  DEFAULT_STATUS,
  MAX_QUERY_CHARS,
  type TextScope,
  type TextStatus,
} from "@/lib/text-filter";
import type {
  LibraryItem,
  Paginated,
  SeriesSummary,
  TagSummary,
  TextDetail,
  TextSummary,
} from "@/lib/types";

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

export type LibraryPage = { items: LibraryItem[]; texts: number } & Paginated;

export function TextsClient({
  initial,
  tags: initialTags,
}: {
  initial: LibraryPage;
  tags: TagSummary[];
}) {
  const { settings } = useSettings();
  const notify = useToast();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TextStatus>(DEFAULT_STATUS);
  const [scope, setScope] = useState<TextScope>(DEFAULT_SCOPE);
  const [tagId, setTagId] = useState<string | null>(null);
  const [tags, setTags] = useState(initialTags);
  const [managingTags, setManagingTags] = useState(false);

  // O termo so chega a consulta depois que a digitacao para.
  const [searched, setSearched] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const filtering = searched.length > 0 || status !== DEFAULT_STATUS || tagId !== null;
  const archived = scope === "arquivados";
  const path =
    `/api/texts?page=${page}&status=${status}&scope=${scope}` +
    (searched ? `&q=${encodeURIComponent(searched)}` : "") +
    (tagId ? `&etiqueta=${tagId}` : "");

  // A primeira pagina da lista principal sem filtro ja veio no HTML.
  const resource = useResource<LibraryPage>(
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
      setTagId(null);
    });

  const refreshTags = async () => {
    try {
      const data = await apiGet<{ tags: TagSummary[] }>("/api/etiquetas");
      setTags(data.tags);
    } catch {
      // A barra de etiquetas continua com o que ja tinha: nao e motivo de erro
      // na tela, a lista de textos ja foi salva.
    }
  };

  const tagIdByName = (name: string) =>
    tags.find((tag) => sameTag(tag.name, name))?.id ?? null;

  const unlinkSeries = async (key: string) => {
    try {
      await apiSend(`/api/series?serie=${encodeURIComponent(key)}`, "DELETE");
      resource.reload();
      notify("Serie desfeita. Os capitulos continuam na biblioteca.", "success");
    } catch {
      notify("Falha ao desfazer a serie.", "error");
    }
  };

  /**
   * Liga ou desliga o acompanhamento (US-70). Ligar de novo uma serie pausada
   * a reativa.
   */
  const followSeries = async (key: string, follow: boolean) => {
    try {
      if (follow) await apiSend("/api/series/acompanhar", "POST", { seriesKey: key });
      else await apiSend(`/api/series/acompanhar?serie=${encodeURIComponent(key)}`, "DELETE");
      resource.reload();
      notify(
        follow ? "Voce sera avisado quando sair um capitulo novo." : "Serie nao e mais acompanhada.",
        "success"
      );
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Falha ao salvar.", "error");
    }
  };

  const unlinkChapter = async (id: string) => {
    try {
      await apiSend(`/api/series?texto=${id}`, "DELETE");
      resource.reload();
      notify("Capitulo desvinculado.", "success");
    } catch {
      notify("Falha ao desvincular.", "error");
    }
  };

  const toggleQueue = async (text: TextSummary) => {
    const inQueue = text.queuePosition !== null;
    try {
      if (inQueue) await apiSend(`/api/fila?texto=${text.id}`, "DELETE");
      else await apiSend("/api/fila", "POST", { textId: text.id });
      resource.reload();
      notify(inQueue ? "Saiu da fila." : "Entrou na fila.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao mudar a fila.", "error");
    }
  };

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
  // Conteudo como estava ao abrir o editor: e a comparacao com ele que diz se
  // os destaques e a posicao de leitura vao embora.
  const [original, setOriginal] = useState("");
  const [pendingDelete, setPendingDelete] = useState<TextSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const items = resource.data?.items ?? [];
  // `total` conta itens da lista (uma serie e um so); `count`, textos. O
  // rotulo fala de textos, a paginacao anda por itens.
  const total = resource.data?.total ?? items.length;
  const count = resource.data?.texts ?? items.length;
  const pageCount = resource.data?.pageCount ?? 1;

  const openEditor = async (text: TextSummary) => {
    try {
      // A listagem nao traz o conteudo; busca so ao abrir o editor.
      const { text: detail } = await apiGet<{ text: TextDetail }>(`/api/texts/${text.id}`);
      setOriginal(detail.content);
      setEditing(detail);
    } catch {
      notify("Nao foi possivel abrir o texto.", "error");
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const { removedHighlights } = await apiSend<{ removedHighlights: number }>(
        `/api/texts/${editing.id}`,
        "PUT",
        {
          title: editing.title,
          sourceUrl: editing.sourceUrl,
          content: editing.content,
          tags: editing.tags,
          language: editing.language,
        }
      );
      setEditing(null);
      resource.reload();
      // As etiquetas podem ter nascido agora: a barra de filtros precisa
      // conhece-las para que o texto salvo seja filtravel no mesmo minuto.
      void refreshTags();
      notify(
        removedHighlights > 0
          ? `Texto atualizado. ${removedHighlights === 1 ? "1 destaque removido" : `${removedHighlights} destaques removidos`}.`
          : "Texto atualizado.",
        "success"
      );
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
      if (items.length === 1 && page > 1) setPage(page - 1);
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
                ? `${count} ${count === 1 ? "resultado" : "resultados"}`
                : `${count} ${count === 1 ? "texto" : "textos"} na biblioteca`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href="/textos/fila"
            aria-label="Fila de leitura"
            title="Fila de leitura"
            className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
          >
            <QueueIcon className="size-5" />
          </Link>
          {/* No celular o botao flutuante da barra inferior ja cobre esta acao. */}
          <span className="hidden sm:block">
            <LinkButton href="/textos/novo" variant="secondary">
              Adicionar
            </LinkButton>
          </span>
        </div>
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

        {tags.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted">Etiquetas</p>
              <button
                type="button"
                onClick={() => setManagingTags(true)}
                className="text-sm font-medium text-accent"
              >
                Organizar
              </button>
            </div>
            {/* Rolagem horizontal: com dez etiquetas, uma grade empurraria a
                lista de textos para fora da primeira tela no celular. */}
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={tagId === tag.id}
                  onClick={() =>
                    changeFilter(() => setTagId(tagId === tag.id ? null : tag.id))
                  }
                  className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors ${
                    tagId === tag.id
                      ? "border-accent bg-accent-soft text-ink"
                      : "border-border text-muted"
                  }`}
                >
                  {tag.name}
                  <span className="tabular text-xs text-faint">{tag.texts}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {resource.loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24 w-full rounded-card" />
          ))}
        </div>
      ) : items.length === 0 ? (
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
            {items.map((item, index) =>
              item.kind === "serie" ? (
                <SeriesCard
                  key={item.key}
                  series={item}
                  wpm={settings.baseWpm}
                  index={index}
                  onUnlink={() => void unlinkSeries(item.key)}
                  onFollow={(follow: boolean) => void followSeries(item.key, follow)}
                  onUnlinkChapter={(id: string) => void unlinkChapter(id)}
                />
              ) : (
                <TextCard
                  key={item.text.id}
                  text={item.text}
                  wpm={settings.baseWpm}
                  index={index}
                  onEdit={() => openEditor(item.text)}
                  onDelete={() => setPendingDelete(item.text)}
                  onToggleArchive={() => void toggleArchive(item.text)}
                  onQueue={() => void toggleQueue(item.text)}
                  onTag={(name) => changeFilter(() => setTagId(tagIdByName(name)))}
                />
              )
            )}
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

      <TagManagerSheet
        open={managingTags}
        tags={tags}
        onClose={() => setManagingTags(false)}
        onChange={(next) => {
          setTags(next);
          // Filtrar por uma etiqueta que acabou de ser excluida devolveria uma
          // lista vazia sem explicacao.
          if (tagId && !next.some((tag) => tag.id === tagId)) changeFilter(() => setTagId(null));
          else resource.reload();
        }}
      />

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

            <SelectField
              label="Idioma do texto"
              name="language"
              hint="Define a voz da leitura em voz alta, o dicionario e o questionario."
              value={editing.language}
              options={LANGUAGES.map((language) => ({
                value: language.code,
                label: language.name,
              }))}
              onChange={(event) => setEditing({ ...editing, language: event.target.value })}
            />

            <TagPicker
              known={tags.map((tag) => tag.name)}
              value={editing.tags}
              onChange={(next) => setEditing({ ...editing, tags: next })}
            />

            {/* O aviso aparece antes de salvar, com o Cancelar ao lado do
                Salvar: os indices dos destaques apontam para as palavras do
                conteudo antigo, e nao ha como remapea-los para um texto que
                pode ter mudado em qualquer ponto. */}
            {editing.content !== original && editing.highlights > 0 ? (
              <Alert>
                {editing.highlights === 1
                  ? "Salvar vai remover o destaque deste texto e reiniciar a leitura."
                  : `Salvar vai remover os ${editing.highlights} destaques deste texto e reiniciar a leitura.`}
              </Alert>
            ) : null}
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
  onQueue,
  onTag,
}: {
  text: TextSummary;
  wpm: number;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  onToggleArchive: () => void;
  onQueue?: () => void;
  onTag?: (name: string) => void;
}) {
  const archived = text.archivedAt !== null;
  const percent =
    text.wordCount > 0 ? Math.round((text.progressIndex / text.wordCount) * 100) : 0;

  return (
    <li className="animate-rise" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Link href={`/leitor/${text.id}`} className="min-w-0 flex-1">
            <p className="font-medium leading-snug">
              {text.fresh ? <NewBadge /> : null}
              {text.title}
            </p>
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
            {onQueue && !archived ? (
              <IconButton
                label={text.queuePosition === null ? "Adicionar a fila" : "Tirar da fila"}
                onClick={onQueue}
                active={text.queuePosition !== null}
              >
                <QueueIcon className="size-5" />
              </IconButton>
            ) : null}
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

        {text.tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {text.tags.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onTag?.(name)}
                className="flex min-h-8 items-center rounded-full bg-surface-2 px-2.5 text-xs font-medium text-muted"
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}

        {/* Fora do <Link> do titulo: um link dentro de outro nao e valido, e
            o toque cairia no destino errado. */}
        {text.highlights > 0 ? (
          <Link
            href={`/textos/${text.id}/destaques`}
            className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-sm font-medium text-muted"
          >
            <MarkIcon className="size-4" />
            {text.highlights === 1 ? "1 destaque" : `${text.highlights} destaques`}
          </Link>
        ) : null}

        {percent > 0 ? (
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </Card>
    </li>
  );
}

/**
 * Cartao de uma serie: um item para todos os capitulos.
 *
 * Fechado ele mostra onde a leitura esta ("cap. 3 de 7") e abre no capitulo
 * atual; aberto lista os capitulos e as acoes de desvinculo, que existem
 * porque a deteccao e heuristica e erra.
 */
function SeriesCard({
  series,
  wpm,
  index,
  onUnlink,
  onUnlinkChapter,
  onFollow,
}: {
  series: SeriesSummary;
  wpm: number;
  index: number;
  onUnlink: () => void;
  onUnlinkChapter: (id: string) => void;
  onFollow: (follow: boolean) => void;
}) {
  const fresh = series.chapters.some((chapter) => chapter.fresh);
  const [open, setOpen] = useState(false);
  const current = series.chapters.find((item) => item.chapter === series.current);
  const read = series.chapters.reduce((sum, item) => sum + item.progressIndex, 0);
  const percent = series.wordCount > 0 ? Math.round((read / series.wordCount) * 100) : 0;

  return (
    <li className="animate-rise" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Link href={`/leitor/${current?.id ?? series.chapters[0]!.id}`} className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 font-medium leading-snug">
              <SeriesIcon className="size-4 shrink-0 text-muted" />
              {fresh ? <NewBadge /> : null}
              <span className="truncate">{series.title}</span>
            </p>
            {series.follow?.paused ? (
              <p className="mt-1 text-sm text-danger">{PAUSED_MESSAGE}</p>
            ) : null}
            <p className="mt-1 text-sm text-muted">
              {`${seriesProgress(series.current, series.total)} · ${formatNumber(series.wordCount)} palavras · ~${estimatedMinutes(series.wordCount, wpm)} min`}
            </p>
          </Link>

          <IconButton
            label={open ? "Fechar capitulos" : "Ver capitulos"}
            onClick={() => setOpen(!open)}
          >
            <ChevronIcon className={`size-5 transition-transform ${open ? "rotate-180" : ""}`} />
          </IconButton>
        </div>

        {percent > 0 ? (
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
        ) : null}

        {open ? (
          <div className="mt-4 space-y-2 border-t border-border pt-3">
            <ul className="space-y-1">
              {series.chapters.map((chapter) => {
                const done = chapter.wordCount > 0 && chapter.progressIndex >= chapter.wordCount;
                return (
                  <li key={chapter.id} className="flex items-center gap-2">
                    <Link href={`/leitor/${chapter.id}`} className="min-w-0 flex-1 py-2">
                      <span className="tabular mr-2 text-sm text-faint">{chapter.chapter}</span>
                      <span className={`text-sm ${done ? "text-faint" : ""}`}>
                        {chapter.fresh ? <NewBadge /> : null}
                        {chapter.title}
                      </span>
                    </Link>
                    {done ? <CheckIcon className="size-4 shrink-0 text-positive" /> : null}
                    <button
                      type="button"
                      onClick={() => onUnlinkChapter(chapter.id)}
                      className="shrink-0 px-2 py-2 text-sm text-muted"
                    >
                      Desvincular
                    </button>
                  </li>
                );
              })}
            </ul>

            {series.follow?.paused ? (
              <Button full onClick={() => onFollow(true)}>
                Tentar acompanhar de novo
              </Button>
            ) : (
              <Button
                variant={series.follow ? "secondary" : "primary"}
                full
                aria-pressed={series.follow !== null}
                onClick={() => onFollow(series.follow === null)}
              >
                {series.follow ? "Deixar de acompanhar" : "Acompanhar novos capitulos"}
              </Button>
            )}
            {series.follow?.paused ? (
              <Button variant="ghost" full onClick={() => onFollow(false)}>
                Deixar de acompanhar
              </Button>
            ) : null}

            <Button variant="secondary" full onClick={onUnlink}>
              Desfazer a serie
            </Button>
          </div>
        ) : null}
      </Card>
    </li>
  );
}

/** Marca de texto importado sozinho e ainda nao lido (US-70, US-71). */
function NewBadge() {
  return (
    <span className="mr-1.5 inline-flex rounded-full bg-accent-soft px-2 py-0.5 align-middle text-xs font-semibold text-accent">
      Novo
    </span>
  );
}

function IconButton({
  label,
  onClick,
  danger,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex size-11 items-center justify-center rounded-full transition-colors ${
        danger
          ? "text-muted hover:bg-danger-soft hover:text-danger"
          : active
            ? "bg-accent-soft text-accent"
            : "text-muted hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
