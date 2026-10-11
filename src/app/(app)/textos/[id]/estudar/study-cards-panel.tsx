"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiSend, consentFrom } from "@/lib/client";
import { AiConsentNotice, AiOffNotice } from "@/components/ai-consent";
import { useToast } from "@/components/providers";
import { Alert, Button, buttonClasses, Card, Segmented, SectionTitle, TextArea } from "@/components/ui";
import { DownloadIcon, EditIcon, PlusIcon, SparkIcon, TrashIcon } from "@/components/icons";
import { NO_CARDS_TO_EXPORT } from "@/lib/anki";
import {
  clozeSentence,
  manualCard,
  MIN_WORDS_FOR_STUDY_CARDS,
  STUDY_CARD_MODE_LABELS,
  STUDY_CARD_MODES,
  type StudyCardDraft,
  type StudyCardMode,
} from "@/lib/study-card-drafts";
import {
  isConcluded,
  isStudyCardKind,
  MAX_CARD_SIDE_CHARS,
  splitByReading,
  STUDY_CARD_KIND_LABELS,
} from "@/lib/study-cards";
import { PretestSession } from "./pretest-session";
import type { StudyProps } from "./study-props";

interface SavedCard {
  id: string;
  front: string;
  back: string;
  kind: string;
  sourceStart: number;
  sourceEnd: number;
  nextReviewOn: string | null;
}

interface CardList {
  cards: SavedCard[];
  unreadCount: number;
  exportableAll: number;
}

/** Rascunho com uma chave local: a lista muda ao descartar. */
type Draft = StudyCardDraft & { key: number };

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

function kindLabel(kind: string): string {
  return isStudyCardKind(kind) ? STUDY_CARD_KIND_LABELS[kind] : kind;
}

/**
 * Cartoes de estudo (US-155 a US-160, US-170).
 *
 * Os cartoes sao gerados do texto completo, mas aqui so aparecem os de
 * trechos ja lidos (`splitByReading`): os demais viram so uma contagem e
 * ficam para o teste de conhecimento previo. Vale para os rascunhos recem
 * gerados, para a lista salva e para a exportacao.
 *
 * O teste de conhecimento previo (US-170) e uma secao propria, logo abaixo:
 * dentro da lista de cartoes, e desativado ate existirem cartoes, ninguem o
 * encontrava. Os dois cartoes dividem o estado (lista e geracao).
 */
export function StudyCardsPanel({ textId, progressIndex, wordCount }: StudyProps) {
  const notify = useToast();
  const router = useRouter();
  const progress = useMemo(() => ({ progressIndex, wordCount }), [progressIndex, wordCount]);

  const [list, setList] = useState<CardList | null>(null);
  const [loadError, setLoadError] = useState("");
  const [ai, setAi] = useState<{ available: boolean; reason: string | null } | null>(null);

  const [mode, setMode] = useState<StudyCardMode>("pergunta");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState<"pending" | "off" | null>(null);

  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState(false);

  const reload = useCallback(async () => {
    try {
      setList(await apiGet<CardList>(`/api/texts/${textId}/cartoes-estudo`));
      setLoadError("");
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "Não consegui carregar os cartões.");
    }
  }, [textId]);

  useEffect(() => {
    let active = true;
    void apiGet<CardList>(`/api/texts/${textId}/cartoes-estudo`)
      .then((data) => {
        if (active) setList(data);
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : "Não consegui carregar os cartões.");
      });
    void apiGet<{ available: boolean; reason: string | null }>(`/api/texts/${textId}/cartoes-estudo/gerar`)
      .then((data) => {
        if (active) setAi(data);
      })
      .catch(() => {
        if (active) setAi({ available: false, reason: "Não consegui verificar a IA agora." });
      });
    return () => {
      active = false;
    };
  }, [textId]);

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const data = await apiSend<{ cards: StudyCardDraft[] }>(
        `/api/texts/${textId}/cartoes-estudo/gerar`,
        "POST",
        { tipo: mode }
      );
      setDrafts(data.cards.map((card, key) => ({ ...card, key })));
      setConsent(null);
    } catch (cause) {
      const state = consentFrom(cause);
      if (state) {
        setConsent(state);
        return;
      }
      setError(cause instanceof Error ? cause.message : "Não consegui criar os cartões agora.");
    } finally {
      setGenerating(false);
    }
  };

  // Rascunhos de trechos nao lidos nao aparecem: sao salvos junto, sem revisao.
  const split = useMemo(() => (drafts ? splitByReading(drafts, progress) : null), [drafts, progress]);

  const change = (key: number, field: "front" | "back", value: string) =>
    setDrafts((current) =>
      current ? current.map((card) => (card.key === key ? { ...card, [field]: value } : card)) : current
    );
  const discard = (key: number) =>
    setDrafts((current) => (current ? current.filter((card) => card.key !== key) : current));

  const save = async () => {
    if (!drafts || drafts.length === 0) return;
    for (const card of drafts) {
      const checked = manualCard(card.front, card.back);
      if ("error" in checked) {
        setError(checked.error);
        return;
      }
      if (card.kind === "lacuna" && !clozeSentence(card.front, card.back)) {
        setError("Mantenha uma lacuna (____) na frente dos cartões de lacuna.");
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      const data = await apiSend<{ saved: number }>(`/api/texts/${textId}/cartoes-estudo`, "PUT", {
        cards: drafts.map(({ front, back, kind, sourceStart, sourceEnd }) => ({
          front,
          back,
          kind,
          sourceStart,
          sourceEnd,
        })),
      });
      setDrafts(null);
      notify(plural(data.saved, "cartão salvo.", "cartões salvos."), "success");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui salvar os cartões.");
    } finally {
      setSaving(false);
    }
  };

  const longEnough = wordCount >= MIN_WORDS_FOR_STUDY_CARDS;
  const aiReason = !longEnough
    ? `O texto precisa ter pelo menos ${MIN_WORDS_FOR_STUDY_CARDS} palavras.`
    : ai && !ai.available
      ? ai.reason
      : null;
  const canGenerate = longEnough && ai?.available === true && consent !== "off";

  const generateForTest = () => {
    document.getElementById("cartoes")?.scrollIntoView({ block: "start" });
    void generate();
  };

  return (
    <>
      <Card as="section" id="cartoes" className="scroll-mt-4 space-y-4 p-4">
        <SectionTitle>Cartões de estudo</SectionTitle>

        {consent === "pending" ? (
          <AiConsentNotice
            onDecided={(allowed) => {
              setConsent(allowed ? null : "off");
              if (allowed) void generate();
            }}
          />
        ) : drafts && split ? (
          <div className="space-y-3" data-testid="cartoes-revisao">
            <p className="text-sm text-muted">
              Revise cada cartão antes de salvar: edite o que quiser e descarte o que não ajuda.
            </p>
            {split.read.length === 0 ? (
              <p className="text-sm text-faint">Nenhum cartão de trecho já lido para revisar.</p>
            ) : (
              <ol className="space-y-4">
                {split.read.map((card, index) => (
                  <li
                    key={card.key}
                    className="space-y-3 rounded-2xl border border-border p-3"
                    data-testid="cartao-estudo-rascunho"
                  >
                    <p className="text-xs font-medium text-faint">{kindLabel(card.kind)}</p>
                    <blockquote className="border-l-2 border-mark pl-3 text-sm text-muted">
                      {card.passage}
                    </blockquote>
                    <TextArea
                      label={`Frente ${index + 1}`}
                      rows={2}
                      maxLength={MAX_CARD_SIDE_CHARS}
                      value={card.front}
                      onChange={(event) => change(card.key, "front", event.target.value)}
                    />
                    <TextArea
                      label={`Verso ${index + 1}`}
                      rows={2}
                      maxLength={MAX_CARD_SIDE_CHARS}
                      value={card.back}
                      onChange={(event) => change(card.key, "back", event.target.value)}
                    />
                    <Button variant="ghost" size="sm" onClick={() => discard(card.key)}>
                      <TrashIcon className="size-4" />
                      Descartar
                    </Button>
                  </li>
                ))}
              </ol>
            )}
            {split.unread.length > 0 ? (
              <p className="text-sm text-muted" data-testid="rascunhos-nao-lidos">
                {`${plural(split.unread.length, "cartão de trecho ainda não lido", "cartões de trechos ainda não lidos")}. ${split.unread.length === 1 ? "Ele é salvo" : "Eles são salvos"} junto e ${split.unread.length === 1 ? "aparece" : "aparecem"} conforme a leitura avança.`}
              </p>
            ) : null}
            {error ? <Alert>{error}</Alert> : null}
            <Button variant="ghost" size="sm" disabled={drafts.length === 0} onClick={() => setDrafts([])}>
              <TrashIcon className="size-4" />
              Descartar todos
            </Button>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                full
                disabled={saving}
                onClick={() => {
                  setDrafts(null);
                  setError("");
                }}
              >
                Cancelar
              </Button>
              <Button full loading={saving} disabled={drafts.length === 0} onClick={() => void save()}>
                Salvar cartões
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <Segmented
                label="Tipo de cartão"
                value={mode}
                onChange={setMode}
                options={STUDY_CARD_MODES.map((value) => ({ value, label: STUDY_CARD_MODE_LABELS[value] }))}
              />
              <Button
                full
                loading={generating}
                disabled={!canGenerate}
                onClick={() => void generate()}
              >
                <SparkIcon className="size-5" />
                Criar cartões de estudo
              </Button>
              {generating ? (
                <p className="text-sm text-muted">Lendo o texto inteiro. Isso pode levar um minuto.</p>
              ) : null}
              {consent === "off" ? <AiOffNotice /> : null}
              {aiReason && consent !== "off" ? (
                <p className="text-sm text-faint" data-testid="cartoes-estudo-motivo">
                  {aiReason}
                </p>
              ) : null}
              {error ? <Alert>{error}</Alert> : null}
            </div>

            {creating ? (
              <ManualCardForm
                textId={textId}
                onCancel={() => setCreating(false)}
                onSaved={() => {
                  setCreating(false);
                  notify("Cartão salvo.", "success");
                  void reload();
                }}
              />
            ) : (
              <Button variant="secondary" full onClick={() => setCreating(true)}>
                <PlusIcon className="size-5" />
                Novo cartão
              </Button>
            )}

            {loadError ? <Alert>{loadError}</Alert> : null}
            {list ? (
              <SavedCards list={list} textId={textId} onChanged={() => void reload()} />
            ) : null}
          </>
        )}
      </Card>

      <PretestSection
        list={list}
        testing={testing}
        concluded={isConcluded(progress)}
        canGenerate={canGenerate}
        generating={generating}
        reason={consent === "off" ? "Os recursos de IA estão desligados." : aiReason}
        textId={textId}
        onStart={() => setTesting(true)}
        onGenerate={generateForTest}
        onClose={() => {
          setTesting(false);
          void reload();
          // A retencao (componente de servidor) mostra o resultado do teste.
          router.refresh();
        }}
      />
    </>
  );
}

/**
 * Teste de conhecimento previo (US-170), em secao propria. Sem cartoes,
 * explica de onde eles vem e oferece cria-los; com todos ja lidos, a opcao
 * fica desativada com o motivo.
 */
function PretestSection({
  list,
  testing,
  concluded,
  canGenerate,
  generating,
  reason,
  textId,
  onStart,
  onGenerate,
  onClose,
}: {
  list: CardList | null;
  testing: boolean;
  concluded: boolean;
  canGenerate: boolean;
  generating: boolean;
  reason: string | null;
  textId: string;
  onStart: () => void;
  onGenerate: () => void;
  onClose: () => void;
}) {
  const unread = list?.unreadCount ?? 0;
  const empty = list !== null && list.cards.length === 0 && unread === 0;

  return (
    <Card as="section" id="previo" className="scroll-mt-4 space-y-4 p-4">
      <div className="space-y-1">
        <SectionTitle>Testar conhecimento prévio</SectionTitle>
        <p className="text-sm text-muted">
          Responda aos cartões das partes que você ainda não leu para ver o que já sabe do assunto e
          onde prestar atenção na leitura. O teste não entra na revisão.
        </p>
      </div>

      {testing ? (
        <PretestSession textId={textId} onClose={onClose} />
      ) : list === null ? null : unread > 0 ? (
        <div className="space-y-2">
          <p className="text-sm" data-testid="previo-disponivel">
            {`${plural(unread, "cartão de trecho ainda não lido", "cartões de trechos ainda não lidos")}.`}
          </p>
          <Button full onClick={onStart}>
            Testar conhecimento prévio
          </Button>
        </div>
      ) : empty && !concluded ? (
        <div className="space-y-3" data-testid="previo-vazio">
          <p className="text-sm text-muted">
            Ainda não há cartões deste texto. Os cartões são criados a partir do texto completo, e o
            teste usa os das partes que você ainda não leu. Crie os cartões primeiro.
          </p>
          <Button full loading={generating} disabled={!canGenerate} onClick={onGenerate}>
            <SparkIcon className="size-5" />
            Criar cartões para o teste
          </Button>
          {reason ? <p className="text-sm text-faint">{reason}</p> : null}
        </div>
      ) : (
        <div className="space-y-2">
          <Button variant="secondary" full disabled>
            Testar conhecimento prévio
          </Button>
          <p className="text-sm text-faint" data-testid="previo-aviso">
            {concluded
              ? "Nenhum cartão de trecho não lido: você já leu o texto inteiro."
              : "Nenhum cartão de trecho não lido."}
          </p>
        </div>
      )}
    </Card>
  );
}

/** Lista salva (so de trechos lidos) e exportacao. */
function SavedCards({
  list,
  textId,
  onChanged,
}: {
  list: CardList;
  textId: string;
  onChanged: () => void;
}) {
  const { cards, unreadCount, exportableAll } = list;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted" data-testid="cartoes-estudo-contagem">
        {cards.length === 0
          ? "Nenhum cartão de trecho já lido."
          : plural(cards.length, "cartão de trecho já lido", "cartões de trechos já lidos")}
        {unreadCount > 0
          ? ` · ${plural(unreadCount, "cartão de trecho ainda não lido", "cartões de trechos ainda não lidos")}`
          : ""}
      </p>

      {cards.length > 0 ? (
        <ul className="space-y-2">
          {cards.map((card) => (
            <SavedCardItem key={card.id} card={card} onChanged={onChanged} />
          ))}
        </ul>
      ) : null}

      <div className="space-y-2">
        {cards.length > 0 ? (
          <a
            href={`/api/cartoes/exportar?texto=${textId}`}
            download
            className={`${buttonClasses("secondary")} w-full`}
          >
            <DownloadIcon className="size-5" />
            Exportar para o Anki
          </a>
        ) : (
          <Button variant="secondary" full disabled>
            <DownloadIcon className="size-5" />
            Exportar para o Anki
          </Button>
        )}
        <p className="text-sm text-faint" data-testid="exportar-aviso">
          {cards.length === 0
            ? NO_CARDS_TO_EXPORT
            : "Arquivo separado por tabulação, com o título do texto como etiqueta. Só entram cartões de trechos já lidos."}
        </p>
        {exportableAll > 0 ? (
          <a
            href="/api/cartoes/exportar"
            download
            className="inline-flex min-h-9 items-center text-sm font-medium text-accent"
          >
            Exportar os cartões de todos os textos
          </a>
        ) : null}
      </div>

      {unreadCount > 0 ? (
        <a href="#previo" className="inline-flex min-h-9 items-center text-sm font-medium text-accent">
          Testar conhecimento prévio com os cartões não lidos
        </a>
      ) : null}
    </div>
  );
}

function SavedCardItem({ card, onChanged }: { card: SavedCard; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    const checked = manualCard(front, back);
    if ("error" in checked) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiSend(`/api/cartoes/${card.id}`, "PATCH", checked);
      setEditing(false);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui salvar o cartão.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await apiSend(`/api/cartoes/${card.id}`, "DELETE");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui apagar o cartão.");
      setBusy(false);
    }
  };

  return (
    <li className="space-y-2 rounded-2xl border border-border p-3" data-testid="cartao-estudo">
      {editing ? (
        <>
          <TextArea label="Frente" rows={2} value={front} onChange={(event) => setFront(event.target.value)} />
          <TextArea label="Verso" rows={2} value={back} onChange={(event) => setBack(event.target.value)} />
          {error ? <Alert>{error}</Alert> : null}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setFront(card.front);
                setBack(card.back);
                setError("");
              }}
            >
              Cancelar
            </Button>
            <Button size="sm" loading={busy} onClick={() => void save()}>
              Salvar
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs font-medium text-faint">{kindLabel(card.kind)}</p>
          <p className="font-medium">{card.front}</p>
          <p className="text-sm text-muted">{card.back}</p>
          {error ? <Alert>{error}</Alert> : null}
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(true)}>
              <EditIcon className="size-4" />
              Editar
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>
              <TrashIcon className="size-4" />
              Apagar
            </Button>
          </div>
        </>
      )}
    </li>
  );
}

/** Cartao criado a mao (US-159): funciona com a IA desligada ou sem cota. */
function ManualCardForm({
  textId,
  onCancel,
  onSaved,
}: {
  textId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    // A mesma validacao da rota, antes do envio: nada e gravado com erro.
    const checked = manualCard(front, back);
    if ("error" in checked) {
      setError(checked.error);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiSend(`/api/texts/${textId}/cartoes-estudo`, "POST", checked);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui salvar o cartão.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-3 rounded-2xl border border-border p-3"
      data-testid="cartao-novo"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <TextArea label="Frente" rows={2} value={front} onChange={(event) => setFront(event.target.value)} />
      <TextArea label="Verso" rows={2} value={back} onChange={(event) => setBack(event.target.value)} />
      <p className="text-sm text-faint">Entra na revisão a partir de amanhã.</p>
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" full disabled={saving} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" full loading={saving}>
          Salvar cartão
        </Button>
      </div>
    </form>
  );
}
