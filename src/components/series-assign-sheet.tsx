"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Alert, Button, Field, SelectField, Sheet } from "@/components/ui";
import { MAX_CHAPTER, type SeriesOption } from "@/lib/series";
import type { TextSummary } from "@/lib/types";

/** Valor do seletor para "criar uma serie nova". */
const NEW = "__nova__";

/**
 * "Adicionar a uma serie": vincula um texto solto a uma serie que ja existe
 * ou a uma nova, com o numero do capitulo. O seguinte ao ultimo e a sugestao.
 */
export function SeriesAssignSheet({
  text,
  onClose,
  onDone,
}: {
  text: TextSummary | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const notify = useToast();
  const [options, setOptions] = useState<SeriesOption[] | null>(null);
  const [choice, setChoice] = useState(NEW);
  const [name, setName] = useState("");
  const [chapter, setChapter] = useState("1");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Cada abertura le a lista de novo: outra folha pode ter criado uma serie.
  const openFor = text?.id ?? null;
  useEffect(() => {
    if (openFor === null) return;
    let alive = true;
    apiGet<{ series: SeriesOption[] }>("/api/series")
      .then(({ series }) => {
        if (!alive) return;
        setOptions(series);
        const first = series[0];
        setChoice(first ? first.key : NEW);
        setChapter(String(first ? Math.min(first.lastChapter + 1, MAX_CHAPTER) : 1));
        setName("");
        setError("");
      })
      .catch(() => {
        if (!alive) return;
        setOptions([]);
        setChoice(NEW);
        setChapter("1");
      });
    return () => {
      alive = false;
    };
  }, [openFor]);

  const close = () => {
    setOptions(null);
    onClose();
  };

  const pick = (value: string) => {
    setChoice(value);
    setError("");
    const option = options?.find((item) => item.key === value);
    setChapter(String(option ? Math.min(option.lastChapter + 1, MAX_CHAPTER) : 1));
  };

  const save = async () => {
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiSend<{ seriesTitle: string; chapter: number }>("/api/series", "POST", {
        texto: text.id,
        capitulo: Number(chapter),
        ...(choice === NEW ? { titulo: name } : { serie: choice }),
      });
      notify(`Adicionado a "${result.seriesTitle}" como capítulo ${result.chapter}.`, "success");
      setOptions(null);
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao adicionar à série.");
    } finally {
      setBusy(false);
    }
  };

  const ready = options !== null;
  const canSave = ready && chapter.trim() !== "" && (choice !== NEW || name.trim() !== "");

  return (
    <Sheet
      open={text !== null}
      onClose={close}
      title="Adicionar a uma série"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" full onClick={close}>
            Cancelar
          </Button>
          <Button full loading={busy} disabled={!canSave} onClick={() => void save()}>
            Adicionar
          </Button>
        </div>
      }
    >
      {text ? (
        <div className="space-y-4" data-testid="adicionar-serie">
          <p className="text-sm text-muted">{text.title}</p>
          {!ready ? (
            <p className="text-sm text-faint" role="status">
              Carregando as séries...
            </p>
          ) : (
            <>
              <SelectField
                label="Série"
                name="serie"
                value={choice}
                onChange={(event) => pick(event.target.value)}
                options={[
                  ...options.map((option) => ({
                    value: option.key,
                    label:
                      option.chapters === 1
                        ? `${option.title} (1 capítulo)`
                        : `${option.title} (${option.chapters} capítulos)`,
                  })),
                  { value: NEW, label: "Nova série" },
                ]}
              />
              {choice === NEW ? (
                <Field
                  label="Nome da nova série"
                  name="nome-serie"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              ) : null}
              <Field
                label="Número do capítulo"
                name="capitulo"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_CHAPTER}
                value={chapter}
                onChange={(event) => setChapter(event.target.value)}
              />
              {error ? <Alert>{error}</Alert> : null}
            </>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}
