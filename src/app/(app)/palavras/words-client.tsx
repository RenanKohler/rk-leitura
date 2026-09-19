"use client";

import { useState } from "react";
import Link from "next/link";
import { apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Button, Card, EmptyState, Field, LinkButton } from "@/components/ui";
import { BackIcon, TrashIcon, WordsIcon } from "@/components/icons";
import { foldForSearch } from "@/lib/text-filter";
import { formatRelativeDay } from "@/lib/reading";
import type { SavedWordItem } from "@/lib/types";

/**
 * Palavras consultadas durante a leitura.
 *
 * A lista e a razao de a consulta ser guardada: uma palavra que interrompeu a
 * leitura uma vez costuma interromper de novo, e revisitar a lista e o que
 * transforma a interrupcao em aprendizado.
 */
export function WordsClient({ initial }: { initial: SavedWordItem[] }) {
  const notify = useToast();
  const [items, setItems] = useState(initial);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const remove = async (id: string) => {
    const before = items;
    setBusy(true);
    setItems(before.filter((item) => item.id !== id));
    try {
      await apiSend(`/api/dicionario?id=${id}`, "DELETE");
    } catch {
      setItems(before);
      notify("Nao consegui remover.", "error");
    } finally {
      setBusy(false);
    }
  };

  const term = foldForSearch(query);
  const shown = term
    ? items.filter(
        (item) =>
          foldForSearch(item.word).includes(term) ||
          foldForSearch(item.base).includes(term) ||
          foldForSearch(item.definition).includes(term)
      )
    : items;

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
        </div>
      </header>

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
                      {item.kind ? <p className="text-xs text-faint">{item.kind}</p> : null}
                    </div>
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

                  <p className="mt-1.5 text-sm leading-relaxed">{item.definition}</p>

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
