"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useLibraryOrder } from "@/hooks/use-library-order";
import { useResource } from "@/hooks/use-resource";
import { apiGet, apiSend } from "@/lib/client";
import { useSettings, useToast } from "@/components/providers";
import { TagPicker } from "@/components/tag-picker";
import { TextSynopsis } from "@/components/text-synopsis";
import { TagManagerSheet } from "@/components/tag-manager-sheet";
import { ContentSearchResults } from "@/components/content-search-results";
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
  MoreIcon,
  QueueIcon,
  RestoreIcon,
  SearchIcon,
  SeriesIcon,
  StudyIcon,
  TrashIcon,
} from "@/components/icons";
import {
  asLibraryOrder,
  LIBRARY_ORDER_OPTIONS,
  readingState,
  readingStateLabel,
  sizeLabel,
  tagCountsApply,
  visibleTags,
  type LibraryOrder,
} from "@/lib/library";
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

// "Ativos", e nao "Todos": o filtro padrao deixa de fora os largados, e o
// numero ao lado dele precisava bater com o do painel e o das etiquetas
// (APP-13).
const STATUS_OPTIONS: { value: TextStatus; label: string }[] = [
  { value: "todos", label: "Ativos" },
  { value: "nao-iniciados", label: "Não lidos" },
  { value: "em-andamento", label: "Lendo" },
  { value: "concluidos", label: "Lidos" },
  { value: "largados", label: "Largados" },
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
  order: serverOrder,
}: {
  initial: LibraryPage;
  tags: TagSummary[];
  /** Ordem em que o servidor montou `initial`, lida do cookie (US-230). */
  order: LibraryOrder;
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
  // Ordem guardada neste aparelho; na hidratacao vale a que o servidor usou.
  const [order, setOrder] = useLibraryOrder(serverOrder);
  const orderId = useId();

  // O termo so chega a consulta depois que a digitacao para.
  const [searched, setSearched] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const filtering = searched.length > 0 || status !== DEFAULT_STATUS || tagId !== null;
  const archived = scope === "arquivados";
  const path =
    `/api/texts?page=${page}&status=${status}&scope=${scope}&ordem=${order}` +
    (searched ? `&q=${encodeURIComponent(searched)}` : "") +
    (tagId ? `&etiqueta=${tagId}` : "");

  // A primeira pagina da lista principal sem filtro ja veio no HTML - na ordem
  // que o servidor leu do cookie. Se a guardada no aparelho for outra (cookie
  // vencido ou apagado), o HTML nao serve e a lista e pedida de novo.
  const resource = useResource<LibraryPage>(
    path,
    page === 1 && !filtering && !archived && order === serverOrder ? initial : undefined
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

  const unlinkSeries = async (key: string) => {
    try {
      await apiSend(`/api/series?serie=${encodeURIComponent(key)}`, "DELETE");
      resource.reload();
      notify("Série desfeita. Os capítulos continuam na biblioteca.", "success");
    } catch {
      notify("Falha ao desfazer a série.", "error");
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
        follow ? "Você será avisado quando sair um capítulo novo." : "Série não é mais acompanhada.",
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
      notify("Capítulo desvinculado.", "success");
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
      notify(restoring ? "Texto de volta à biblioteca." : "Texto arquivado.", "success");
      resource.reload();
    } catch {
      notify(restoring ? "Falha ao desarquivar." : "Falha ao arquivar.", "error");
    }
  };
  /** Retoma um texto largado (US-79): volta a lista na posicao em que parou. */
  const resumeText = async (text: TextSummary) => {
    try {
      await apiSend(`/api/texts/${text.id}/largar`, "DELETE");
      notify("Texto de volta à biblioteca.", "success");
      resource.reload();
    } catch {
      notify("Falha ao retomar.", "error");
    }
  };
  const [editing, setEditing] = useState<TextDetail | null>(null);
  // Conteudo como estava ao abrir o editor: e a comparacao com ele que diz se
  // os destaques e a posicao de leitura vao embora.
  const [original, setOriginal] = useState("");
  const [pendingDelete, setPendingDelete] = useState<TextSummary | null>(null);
  // So o id: o texto da folha vem da lista, e assim a sinopse pedida ali
  // (US-230) aparece na folha e continua la quando ela e aberta de novo.
  const [menuId, setMenuId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const items = resource.data?.items ?? [];
  const menuText = findText(items, menuId);
  // Fora da lista principal ativa a contagem das etiquetas fala de outros
  // textos: ali nenhuma some da faixa e o numero nao aparece.
  const tagCounts = tagCountsApply(scope, status);
  const shownTags = visibleTags(tags, tagCounts, tagId);

  /** Guarda na lista a sinopse recem-gerada, sem pedir a pagina de novo. */
  const rememberSynopsis = (id: string, synopsis: string) =>
    resource.setData((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.kind === "texto" && item.text.id === id
                ? { kind: "texto", text: { ...item.text, synopsis } }
                : item
            ),
          }
        : current
    );

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
      notify("Não foi possível abrir o texto.", "error");
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
          // So quando mudou (US-179): um texto acima do limite continua
          // editavel no titulo e nas etiquetas.
          ...(editing.content !== original ? { content: editing.content } : {}),
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
    // Cabecalho curto (US-230). No celular (412 x 839) o primeiro texto
    // comecava em y = 438, com dois textos por tela. Agora, pelas alturas:
    // 16 de respiro, titulo 48, abas 42, busca e leitura 48, etiquetas 44 e
    // contagem com ordem 44, com 8 entre as faixas - o primeiro item comeca
    // em y = 274 (222 sem etiquetas). Quatro itens dos mais altos (110 cada,
    // 8 entre eles) terminam em y = 738, acima da barra de navegacao, que
    // comeca em 759.
    <div className="space-y-2">
      <header className="flex min-h-12 items-center justify-between gap-3">
        <h1 className="text-headline-small">Meus textos</h1>
        <div className="flex shrink-0 items-center gap-2">
          {/* Com rotulo (US-230): so o icone nao dizia para onde levava. */}
          <Link
            href="/textos/fila"
            aria-label="Fila de leitura"
            className="state-layer inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-sm font-medium tracking-[0.1px] text-primary"
          >
            <QueueIcon className="size-5" />
            Fila
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
          de "Lidos". O titulo da pagina ja diz o que e, dai o rotulo so para
          leitor de tela. */}
      <Segmented<TextScope>
        label="Aba da biblioteca"
        hideLabel
        value={scope}
        onChange={(value) => changeFilter(() => setScope(value))}
        options={SCOPE_OPTIONS}
      />

      {/* O cartao de importar saiu daqui (APP-14): o + da navegacao ja leva a
          Novo texto, e ele empurrava a lista para fora da primeira tela.

          Busca e filtro de leitura numa faixa so (US-230). Empilhados, o campo
          com rotulo e os cinco chips em duas linhas somavam 188px. Os chips
          ja tinham morado numa faixa rolavel, e "Largados" aparecia cortado
          sem sinal de que havia mais; agora a borda esmaece, como na faixa de
          etiquetas. O campo alarga com o foco ou com texto digitado. */}
      <Strip>
        <label className="relative flex shrink-0">
          <span className="sr-only">Buscar</span>
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-on-surface-variant" />
          <input
            type="search"
            name="busca"
            inputMode="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={MAX_QUERY_CHARS}
            placeholder="Buscar"
            value={query}
            onChange={(event) => changeFilter(() => setQuery(event.target.value))}
            // Campo "outlined" do M3 como os de `ui.tsx`, em pilula e com
            // 48px: divide a faixa com os chips. 16px de fonte, para o
            // navegador do celular nao dar zoom ao focar.
            className={`h-12 rounded-full border border-outline bg-transparent pl-11 pr-4 text-base text-on-surface placeholder:text-on-surface-variant transition-[width,border-color,box-shadow] duration-150 hover:border-on-surface focus:w-60 focus:border-primary focus:shadow-[inset_0_0_0_1px_var(--md-sys-color-primary)] focus:outline-none ${
              query ? "w-60" : "w-40"
            }`}
          />
        </label>
        <div role="group" aria-label="Filtrar por leitura" className="flex shrink-0 gap-2">
          {STATUS_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              pressed={status === option.value}
              onClick={() => changeFilter(() => setStatus(option.value))}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </Strip>

      {/* Etiquetas podem ser muitas: ficam numa faixa propria com rolagem
          horizontal, sem barra visivel e com a borda esmaecida indicando que
          ha mais. A rolagem fica dentro da faixa (A11Y-17). As que nao marcam
          nenhum texto da lista principal saem dela (US-230) e continuam em
          "Organizar etiquetas". */}
      {tags.length > 0 ? (
        <Strip>
          {shownTags.length > 0 ? (
            <div role="group" aria-label="Filtrar por etiqueta" className="flex shrink-0 gap-2">
              {shownTags.map((tag) => (
                <Chip
                  key={tag.id}
                  pressed={tagId === tag.id}
                  onClick={() => changeFilter(() => setTagId(tagId === tag.id ? null : tag.id))}
                >
                  {tag.name}
                  {/* A contagem e a da lista principal: nos arquivados e nos
                      largados ela diria um numero que a lista nao mostra. */}
                  {tagCounts ? (
                    <span className="tabular text-xs text-faint">{tag.texts}</span>
                  ) : null}
                </Chip>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setManagingTags(true)}
            className="flex min-h-11 shrink-0 items-center px-2 text-sm font-medium text-accent"
          >
            Organizar etiquetas
          </button>
        </Strip>
      ) : null}

      <div>
        {/* Contagem e ordem dividem a ultima faixa do cabecalho. Quebra de
            linha so em tela muito estreita (320px), onde as duas nao cabem
            lado a lado (A11Y-17). */}
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3">
          <p className="text-sm text-muted">
            {resource.loading
              ? "Carregando"
              : filtering
                ? `${count} ${count === 1 ? "resultado" : "resultados"}`
                : `${count} ${count === 1 ? "texto" : "textos"}`}
          </p>
          {/* Lista nativa: duas opcoes, e no celular abre o seletor do sistema. */}
          <div className="flex items-center gap-1">
            <label htmlFor={orderId} className="text-sm text-muted">
              Ordem
            </label>
            <select
              id={orderId}
              data-testid="ordem-da-lista"
              value={order}
              onChange={(event) =>
                changeFilter(() => setOrder(asLibraryOrder(event.target.value)))
              }
              className="min-h-11 rounded-lg pl-2 pr-1 text-sm font-medium text-primary"
            >
              {LIBRARY_ORDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {resource.loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-18 w-full rounded-card" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card>
            {archived && !filtering ? (
              <EmptyState
                icon={<ArchiveIcon className="size-7" />}
                title="Nada arquivado"
                description="Textos concluídos vêm parar aqui, e o histórico de leitura deles continua contando."
              />
            ) : filtering ? (
              <EmptyState
                icon={<LibraryIcon className="size-7" />}
                title="Nenhum texto encontrado"
                description="Nada na biblioteca corresponde à busca e ao filtro escolhidos."
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
                description="Importe um artigo pelo link, cole um texto seu ou escolha um arquivo."
                action={<LinkButton href="/textos/novo">Adicionar texto</LinkButton>}
              />
            )}
          </Card>
        ) : (
          <div className="space-y-4">
            <ul className="space-y-2">
              {items.map((item, index) =>
                item.kind === "serie" ? (
                  <SeriesItem
                    key={item.key}
                    series={item}
                    wpm={settings.baseWpm}
                    index={index}
                    onUnlink={() => void unlinkSeries(item.key)}
                    onFollow={(follow: boolean) => void followSeries(item.key, follow)}
                    onUnlinkChapter={(id: string) => void unlinkChapter(id)}
                  />
                ) : (
                  <TextItem
                    key={item.text.id}
                    text={item.text}
                    wpm={settings.baseWpm}
                    index={index}
                    onMore={() => setMenuId(item.text.id)}
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
          </div>
        )}
      </div>

      {/* Busca no conteudo (APP-16): a parte, porque varre o texto inteiro de
          cada item e leva direto a palavra encontrada. O respiro some junto
          quando nao ha resultado para mostrar. */}
      {searched && !archived ? (
        <div className="pt-4 empty:hidden">
          <ContentSearchResults query={searched} />
        </div>
      ) : null}

      <TextActionsSheet
        text={menuText}
        onClose={() => setMenuId(null)}
        onEdit={(text) => void openEditor(text)}
        onDelete={setPendingDelete}
        onToggleArchive={(text) => void toggleArchive(text)}
        onQueue={(text) => void toggleQueue(text)}
        onResume={(text) => void resumeText(text)}
        onSynopsis={rememberSynopsis}
      />

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
              label="Título"
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
              label="Conteúdo"
              name="content"
              rows={12}
              value={editing.content}
              onChange={(event) => setEditing({ ...editing, content: event.target.value })}
            />

            <SelectField
              label="Idioma do texto"
              name="language"
              hint="Define a voz da leitura em voz alta, o dicionário e o questionário."
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
          &quot;{pendingDelete?.title}&quot; e todo o histórico de leitura dele serão apagados. Essa
          ação não pode ser desfeita.
        </p>
      </Sheet>
    </div>
  );
}

/** O texto solto com este id entre os itens da pagina; capitulo de serie nao tem folha. */
function findText(items: LibraryItem[], id: string | null): TextSummary | null {
  if (id === null) return null;
  for (const item of items) {
    if (item.kind === "texto" && item.text.id === id) return item.text;
  }
  return null;
}

/**
 * Acoes de um texto (APP-14), numa folha so para a lista toda.
 *
 * Fica fora do cartao de proposito: o cartao anima com opacidade, o que cria
 * um contexto de empilhamento, e uma folha la dentro ficaria por baixo da
 * barra de navegacao e dos cartoes seguintes.
 *
 * Com o item compacto (US-230) vem para ca tudo o que ocupava linhas proprias
 * no cartao: a sinopse e o pedido dela, "Estudar", os destaques, "Retomar" do
 * texto largado, e o autor e a origem por extenso, que no item cabem cortados
 * ou nao aparecem.
 */
function TextActionsSheet({
  text,
  onClose,
  onEdit,
  onDelete,
  onToggleArchive,
  onQueue,
  onResume,
  onSynopsis,
}: {
  text: TextSummary | null;
  onClose: () => void;
  onEdit: (text: TextSummary) => void;
  onDelete: (text: TextSummary) => void;
  onToggleArchive: (text: TextSummary) => void;
  onQueue: (text: TextSummary) => void;
  onResume: (text: TextSummary) => void;
  onSynopsis: (id: string, synopsis: string) => void;
}) {
  const archived = text?.archivedAt != null;

  // Cada acao fecha a folha antes: editar e remover abrem outra folha, e duas
  // abertas ao mesmo tempo brigariam pelo foco.
  const act = (action: (text: TextSummary) => void) => () => {
    if (!text) return;
    onClose();
    action(text);
  };

  return (
    <Sheet open={text !== null} onClose={onClose} title={text?.title ?? ""}>
      {text ? (
        <div className="space-y-3" data-testid="acoes-do-texto">
          {text.author || text.sourceUrl ? (
            <div className="space-y-0.5 text-sm text-muted">
              {text.author ? <p>{text.author}</p> : null}
              {text.sourceUrl ? (
                <p className="break-anywhere line-clamp-2 text-xs">{text.sourceUrl}</p>
              ) : null}
            </div>
          ) : null}

          {/* A chave leva a data de alteracao: editar ou continuar o texto
              descarta a sinopse que estava na tela junto com a do banco. */}
          <TextSynopsis
            key={`${text.id}:${text.updatedAt}`}
            text={text}
            onGenerated={(synopsis) => onSynopsis(text.id, synopsis)}
          />

          <ul className="space-y-1">
            {/* Largado (US-79): retomar e o que se vem fazer nesta lista. */}
            {text.abandoned ? (
              <MenuAction icon={<RestoreIcon className="size-5" />} onClick={act(onResume)}>
                Retomar
              </MenuAction>
            ) : null}
            {/* Estudar (US-155 a US-170): cartoes, teste de conhecimento
                previo, glossario e fichamento do texto. */}
            <MenuLink href={`/textos/${text.id}/estudar`} icon={<StudyIcon className="size-5" />}>
              Estudar
            </MenuLink>
            {text.highlights > 0 ? (
              <MenuLink
                href={`/textos/${text.id}/destaques`}
                icon={<MarkIcon className="size-5" />}
              >
                {text.highlights === 1 ? "1 destaque" : `${text.highlights} destaques`}
              </MenuLink>
            ) : null}
            {!archived && !text.abandoned ? (
              <MenuAction icon={<QueueIcon className="size-5" />} onClick={act(onQueue)}>
                {text.queuePosition == null ? "Adicionar à fila" : "Tirar da fila"}
              </MenuAction>
            ) : null}
            <MenuAction
              icon={
                archived ? <RestoreIcon className="size-5" /> : <ArchiveIcon className="size-5" />
              }
              onClick={act(onToggleArchive)}
            >
              {archived ? "Voltar à biblioteca" : "Arquivar"}
            </MenuAction>
            <MenuAction icon={<EditIcon className="size-5" />} onClick={act(onEdit)}>
              Editar
            </MenuAction>
            <MenuAction icon={<TrashIcon className="size-5" />} onClick={act(onDelete)} danger>
              Remover
            </MenuAction>
          </ul>
        </div>
      ) : null}
    </Sheet>
  );
}

/**
 * Area tocavel do item: o link ocupa o cartao inteiro menos o botao. O
 * contorno de foco fica por dentro, porque o cartao corta o que sai dele
 * (e ele precisa cortar, para o indicador de progresso seguir o canto).
 */
const ITEM_LINK = "state-layer min-w-0 flex-1 py-3 pl-4 pr-2 focus-visible:-outline-offset-3";

/**
 * Item compacto de um texto (US-230).
 *
 * O cartao antigo tinha de 176 a 242px: titulo, autor, dados, origem,
 * etiquetas em chips, sinopse, "Estudar", destaques e a barra de progresso,
 * cada um na sua linha - dois textos por tela no celular. Aqui ficam o titulo
 * (ate duas linhas), uma linha de dados e uma de etiquetas: 70px no caso
 * comum, 110px no pior. O resto mora na folha "Mais acoes".
 *
 * O item inteiro abre o leitor; o unico outro alvo e o botao da folha, depois
 * do link na ordem do foco. As etiquetas viraram texto: como chips tocaveis
 * dentro de um item que ja e um link, tinham 32px e roubavam o toque. O
 * filtro por etiqueta continua na faixa do cabecalho.
 */
function TextItem({
  text,
  wpm,
  index,
  onMore,
}: {
  text: TextSummary;
  wpm: number;
  index: number;
  onMore: () => void;
}) {
  const state = readingState(text);
  const label = readingStateLabel(state);

  return (
    <li
      className="animate-rise"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      data-testid="item-da-biblioteca"
    >
      <Card className="relative flex items-center overflow-hidden pr-1">
        <Link href={`/leitor/${text.id}`} className={ITEM_LINK}>
          <p className="line-clamp-2 font-medium leading-snug" data-testid="titulo-do-item">
            {text.title}
          </p>
          {/* O estado vem primeiro: a linha corta com reticencias no celular,
              e o que se perde no corte e o fim dela. */}
          <p className="mt-0.5 truncate text-sm text-muted">
            {label ? (
              <>
                <span
                  className={`font-medium ${state.kind === "novo" ? "text-accent" : "text-ink"}`}
                >
                  {label}
                </span>
                {" · "}
              </>
            ) : null}
            {sizeLabel(text.wordCount, wpm)}
            {text.author ? (
              <>
                {" · "}
                <span data-testid="autor">{text.author}</span>
              </>
            ) : null}
          </p>
          {text.tags.length > 0 ? (
            <p className="mt-0.5 truncate text-xs text-muted" data-testid="etiquetas-do-item">
              <span className="sr-only">Etiquetas: </span>
              {text.tags.join(" · ")}
            </p>
          ) : null}
        </Link>

        {/* Um botao so, e ele abre a folha com todas as acoes (APP-14,
            US-230): alcancavel no toque e no teclado, sem depender de hover. */}
        <ItemButton label={`Mais ações: ${text.title}`} onClick={onMore}>
          <MoreIcon className="size-5" />
        </ItemButton>

        {state.kind === "lendo" ? <ProgressLine percent={state.percent} /> : null}
      </Card>
    </li>
  );
}

/**
 * Indicador fino de leitura em andamento, na borda de baixo do item: nao
 * soma altura. E so visual - a linha de dados ja diz "35% lido".
 */
function ProgressLine({ percent }: { percent: number }) {
  return (
    <span
      aria-hidden="true"
      data-testid="progresso-do-item"
      className="pointer-events-none absolute inset-x-0 bottom-0 block h-1 bg-surface-2"
    >
      <span className="block h-full rounded-r-full bg-accent" style={{ width: `${percent}%` }} />
    </span>
  );
}

/**
 * Item de uma serie: um so para todos os capitulos.
 *
 * Fechado ele mostra onde a leitura esta ("cap. 3 de 7") e abre no capitulo
 * atual; aberto lista os capitulos e as acoes de desvinculo, que existem
 * porque a deteccao e heuristica e erra.
 *
 * Mesma compactacao do item de texto (US-230): titulo, uma linha de dados e o
 * indicador de progresso na borda, com um botao so - o que abre os capitulos.
 */
function SeriesItem({
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
  // Capitulo novo de serie acompanhada (US-70): o aviso vale mesmo com a
  // serie ja em andamento, por isso nao vem do estado de leitura dela.
  const fresh = series.chapters.some((chapter) => chapter.fresh);
  const [open, setOpen] = useState(false);
  const current = series.chapters.find((item) => item.chapter === series.current);
  const read = series.chapters.reduce((sum, item) => sum + item.progressIndex, 0);
  const state = readingState({ progressIndex: read, wordCount: series.wordCount });

  return (
    <li
      className="animate-rise"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      data-testid="item-da-biblioteca"
    >
      <Card className="overflow-hidden">
        {/* O indicador se prende a esta faixa: fechada, ela e a borda de baixo
            do cartao; aberta, ele separa o cabecalho dos capitulos. */}
        <div className="relative flex items-center pr-1">
          <Link href={`/leitor/${current?.id ?? series.chapters[0]!.id}`} className={ITEM_LINK}>
            <p className="flex items-start gap-1.5 font-medium leading-snug">
              {/* 3px: centra o icone de 16px na primeira linha, de 22px. */}
              <SeriesIcon className="mt-[3px] size-4 shrink-0 text-muted" />
              <span className="line-clamp-2" data-testid="titulo-do-item">
                {series.title}
              </span>
            </p>
            {series.follow?.paused ? (
              <p className="mt-0.5 text-sm text-danger">{PAUSED_MESSAGE}</p>
            ) : null}
            <p className="mt-0.5 truncate text-sm text-muted">
              {fresh ? (
                <>
                  <span className="font-medium text-accent">Novo</span>
                  {" · "}
                </>
              ) : null}
              {`${seriesProgress(series.current, series.total)} · ${sizeLabel(series.wordCount, wpm)}`}
            </p>
          </Link>

          <ItemButton
            label={open ? "Fechar capítulos" : "Ver capítulos"}
            onClick={() => setOpen(!open)}
          >
            <ChevronIcon className={`size-5 transition-transform ${open ? "rotate-180" : ""}`} />
          </ItemButton>

          {state.kind === "lendo" ? <ProgressLine percent={state.percent} /> : null}
        </div>

        {open ? (
          <div className="space-y-2 border-t border-border px-4 pb-4 pt-3">
            <ul className="space-y-1">
              {series.chapters.map((chapter) => {
                const done = chapter.wordCount > 0 && chapter.progressIndex >= chapter.wordCount;
                return (
                  <li key={chapter.id} className="flex items-center gap-2">
                    <Link
                      href={`/leitor/${chapter.id}`}
                      className="flex min-h-11 min-w-0 flex-1 items-center"
                    >
                      <span className="tabular mr-2 text-sm text-faint">{chapter.chapter}</span>
                      <span className={`min-w-0 text-sm ${done ? "text-faint" : ""}`}>
                        {chapter.fresh ? <NewBadge /> : null}
                        {chapter.title}
                      </span>
                    </Link>
                    {done ? <CheckIcon className="size-4 shrink-0 text-positive" /> : null}
                    <button
                      type="button"
                      onClick={() => onUnlinkChapter(chapter.id)}
                      className="flex min-h-11 shrink-0 items-center px-2 text-sm text-muted"
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
                {series.follow ? "Deixar de acompanhar" : "Acompanhar novos capítulos"}
              </Button>
            )}
            {series.follow?.paused ? (
              <Button variant="ghost" full onClick={() => onFollow(false)}>
                Deixar de acompanhar
              </Button>
            ) : null}

            <Button variant="secondary" full onClick={onUnlink}>
              Desfazer a série
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
    <span className="mr-1.5 inline-flex rounded-full bg-accent-soft px-2 py-0.5 align-middle text-xs font-medium text-accent">
      Novo
    </span>
  );
}

/** Filtro da faixa de chips: alterna, e diz se esta ligado. */
function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
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

function MenuAction({
  icon,
  onClick,
  danger,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-medium hover:bg-surface-2 ${
          danger ? "text-danger" : "text-ink"
        }`}
      >
        {icon}
        {children}
      </button>
    </li>
  );
}

/** Link com a mesma cara das acoes da folha. */
function MenuLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-medium text-ink hover:bg-surface-2"
      >
        {icon}
        {children}
      </Link>
    </li>
  );
}

/**
 * O unico botao de um item da lista (US-230): 48px, o alvo de toque de acao
 * principal. O contorno de foco fica por dentro, como o do link ao lado: o
 * cartao corta o que sai dele.
 */
function ItemButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="state-layer flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant focus-visible:-outline-offset-3"
    >
      {children}
    </button>
  );
}

/**
 * Faixa de filtros com rolagem horizontal, de borda a borda da tela.
 *
 * O anel de foco sai 5px para fora do controle, e um conteiner com rolagem
 * corta o que passa dele tambem na vertical: o respiro de 6px em cima e
 * embaixo da lugar ao anel, e a margem negativa devolve a altura a faixa. O
 * `flow-root` de fora segura essa margem, que senao comeria o espaco entre
 * as faixas.
 */
function Strip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flow-root">
      <div className="chip-scroller -mx-4 -my-1.5 flex items-center gap-2 overflow-x-auto px-4 py-1.5">
        {children}
        {/* Respiro no fim: o padding final de um conteiner com rolagem nem
            sempre conta, e o ultimo item encostava na borda. */}
        <span aria-hidden="true" className="w-2 shrink-0" />
      </div>
    </div>
  );
}
