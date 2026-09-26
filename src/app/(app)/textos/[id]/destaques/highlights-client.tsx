"use client";

import { useState } from "react";
import Link from "next/link";
import { apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Button, Card, EmptyState, SectionTitle } from "@/components/ui";
import { BackIcon, CopyIcon, DownloadIcon, MarkIcon, TrashIcon } from "@/components/icons";
import { exportFileName, toMarkdown } from "@/lib/highlights";
import { annotatedFileName, annotatedMarkdown } from "@/lib/annotated-export";
import type { TextFormat } from "@/lib/reading";
import type { HighlightItem } from "@/lib/types";

/**
 * Lista dos destaques de um texto, na ordem da leitura.
 *
 * O Markdown e montado aqui, a partir da mesma lista que esta na tela: uma
 * rota de exportacao teria de reconstruir os trechos do zero e poderia
 * discordar do que o leitor acabou de ver.
 */
export function HighlightsClient({
  textId,
  title,
  sourceUrl,
  content,
  format,
  initial,
}: {
  textId: string;
  title: string;
  sourceUrl: string | null;
  content: string;
  format: TextFormat;
  initial: HighlightItem[];
}) {
  const notify = useToast();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);

  const markdown = () =>
    toMarkdown(
      { title, sourceUrl },
      items.map((item) => ({ start: item.start, excerpt: item.excerpt, note: item.note }))
    );

  const save = (body: string, filename: string) => {
    const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const download = () => save(markdown(), exportFileName(title));

  /** O texto inteiro com os destaques marcados e as notas (US-100). */
  const downloadAnnotated = () =>
    save(
      annotatedMarkdown(
        { title, sourceUrl, content, format },
        items.map((item) => ({ start: item.start, end: item.end, note: item.note }))
      ),
      annotatedFileName(title)
    );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown());
      notify("Destaques copiados.", "success");
    } catch {
      // Sem permissao de area de transferencia (ou fora de HTTPS) o arquivo
      // continua sendo um caminho: a exportacao nao depende de um so gesto.
      notify("Nao consegui copiar. Use o download.", "error");
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await apiSend(`/api/texts/${textId}/destaques/${id}`, "DELETE");
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Nao consegui remover.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="flex items-start gap-2">
        <Link
          href={`/leitor/${textId}`}
          aria-label="Voltar para o texto"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        >
          <BackIcon className="size-5" />
        </Link>
        <div className="min-w-0 flex-1 pt-2">
          <h1 className="text-xl font-semibold leading-tight tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted">
            {items.length === 1 ? "1 destaque" : `${items.length} destaques`}
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<MarkIcon className="size-6" />}
          title="Nenhum destaque ainda"
          description="Selecione um trecho durante a leitura para marcar, ou use Destacar frase no modo Foco."
          action={
            <div className="flex flex-col gap-2">
              <Link href={`/leitor/${textId}`}>
                <Button size="lg" full>
                  Abrir o texto
                </Button>
              </Link>
              <Button variant="secondary" onClick={downloadAnnotated}>
                <DownloadIcon className="size-5" />
                Baixar o texto em .md
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="mt-5 flex gap-2">
            <Button variant="secondary" full onClick={download}>
              <DownloadIcon className="size-5" />
              Baixar .md
            </Button>
            <Button variant="secondary" full onClick={() => void copy()}>
              <CopyIcon className="size-5" />
              Copiar
            </Button>
          </div>
          <Button variant="secondary" full className="mt-2" onClick={downloadAnnotated}>
            <DownloadIcon className="size-5" />
            Baixar o texto anotado (.md)
          </Button>

          <div className="mt-6">
            <SectionTitle>Trechos</SectionTitle>
          </div>

          <ul className="mt-3 space-y-3">
            {items.map((item, position) => (
              <li
                key={item.id}
                className="animate-rise"
                style={{ animationDelay: `${Math.min(position, 8) * 40}ms` }}
              >
                <Card className="p-4">
                  {/* O toque no trecho leva a leitura ate ele: revisar a nota
                      e voltar ao contexto sao a mesma tarefa. */}
                  <Link href={`/leitor/${textId}?de=${item.start}`} className="block">
                    <blockquote className="border-l-2 border-mark pl-3 text-sm leading-relaxed">
                      {item.excerpt}
                    </blockquote>
                  </Link>

                  {item.note ? (
                    <p className="mt-3 whitespace-pre-line rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
                      {item.note}
                    </p>
                  ) : null}

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Link
                      href={`/leitor/${textId}?de=${item.start}`}
                      className="text-sm font-medium text-accent"
                    >
                      Ler a partir daqui
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void remove(item.id)}
                    >
                      <TrashIcon className="size-4" />
                      Remover
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
