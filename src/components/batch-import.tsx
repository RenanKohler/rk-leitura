"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card } from "@/components/ui";
import { CheckIcon, CloseIcon, FileIcon } from "@/components/icons";
import { linksFromFile, MAX_BATCH_LINKS, type BatchLink } from "@/lib/batch-links";
import type { ImportedText, TextDetail } from "@/lib/types";

/** Espera entre um link e o proximo: a importacao busca paginas de terceiros. */
const PACE_MS = 1_000;
/** Espera maxima quando o limite de importacoes estoura, antes de desistir do item. */
const MAX_WAIT_S = 600;

type Status =
  | { state: "pendente" }
  | { state: "importando" }
  | { state: "ok"; textId: string; title: string; queued: boolean }
  | { state: "falhou"; message: string };

interface Item extends BatchLink {
  status: Status;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** POST com o corpo de volta mesmo na falha: o 429 traz quanto esperar. */
async function post<T>(
  path: string,
  body: unknown
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; retryAfter?: number }> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as T & {
      error?: string;
      retryAfter?: number;
    };
    if (response.ok) return { ok: true, data };
    return {
      ok: false,
      status: response.status,
      error: data.error ?? "Falha na requisição.",
      retryAfter: typeof data.retryAfter === "number" ? data.retryAfter : undefined,
    };
  } catch {
    return { ok: false, status: 0, error: "Sem conexão." };
  }
}

/**
 * Importacao de links em lote (PROD-17): CSV do Instapaper, Pocket ou
 * Readwise, ou o HTML do Pocket.
 *
 * Cada link passa pela mesma importacao por URL da aba Link, um de cada vez,
 * com um segundo entre eles: disparar duzentas buscas juntas faria o servidor
 * parecer um robo para os sites e estouraria o limite de importacoes na
 * hora. Quando o limite estoura mesmo assim, a fila espera o tempo que a
 * rota pede e continua. Falha de um link nao para o lote: fica marcada no
 * item e entra no resumo.
 */
export function BatchImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const [items, setItems] = useState<Item[]>([]);
  const [fileName, setFileName] = useState("");
  const [truncated, setTruncated] = useState(0);
  const [error, setError] = useState("");
  const [queue, setQueue] = useState(false);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [waiting, setWaiting] = useState(0);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setFinished(false);
    try {
      const { links, truncated: over } = linksFromFile(file.name, await file.text());
      if (links.length === 0) {
        setItems([]);
        setError("Nenhum link encontrado no arquivo. Envie o CSV com a coluna URL ou o HTML do Pocket.");
        return;
      }
      setFileName(file.name);
      setTruncated(over);
      setItems(links.map((link) => ({ ...link, status: { state: "pendente" } })));
    } catch {
      setError("Não consegui ler o arquivo.");
    }
  };

  const update = (index: number, status: Status) =>
    setItems((current) => current.map((item, position) => (position === index ? { ...item, status } : item)));

  const importOne = async (link: BatchLink): Promise<Status> => {
    // Busca a pagina; no limite de importacoes, espera e tenta de novo.
    for (;;) {
      const imported = await post<ImportedText>("/api/import-url", { url: link.url });
      if (imported.ok) {
        const created = await post<{ text: TextDetail }>("/api/texts", {
          title: (imported.data.title || link.title || link.url).slice(0, 200),
          sourceUrl: imported.data.sourceUrl,
          content: imported.data.content,
          language: imported.data.language,
        });
        if (!created.ok) return { state: "falhou", message: created.error };
        const text = created.data.text;
        let queued = false;
        if (queue) {
          const added = await post("/api/fila", { textId: text.id });
          queued = added.ok;
        }
        return { state: "ok", textId: text.id, title: text.title, queued };
      }
      if (imported.status === 429 && imported.retryAfter && imported.retryAfter <= MAX_WAIT_S) {
        for (let left = imported.retryAfter; left > 0 && !cancelRef.current; left -= 1) {
          setWaiting(left);
          await sleep(1_000);
        }
        setWaiting(0);
        if (cancelRef.current) return { state: "falhou", message: "Cancelado." };
        continue;
      }
      return { state: "falhou", message: imported.error };
    }
  };

  const run = async () => {
    cancelRef.current = false;
    setRunning(true);
    setFinished(false);
    for (let index = 0; index < items.length; index += 1) {
      if (cancelRef.current) break;
      if (items[index]!.status.state === "ok") continue;
      update(index, { state: "importando" });
      update(index, await importOne(items[index]!));
      if (index < items.length - 1) await sleep(PACE_MS);
    }
    setRunning(false);
    setFinished(true);
  };

  const done = items.filter((item) => item.status.state === "ok").length;
  const failed = items.filter((item) => item.status.state === "falhou").length;

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <p className="text-sm text-muted">
          {`Envie a lista exportada do Instapaper, Pocket ou Readwise (.csv com a coluna URL) ou o export em HTML do Pocket. Até ${MAX_BATCH_LINKS} links, importados um por segundo.`}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.html,.htm,.txt,text/csv,text/html"
          className="sr-only"
          aria-label="Arquivo com links"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        <Button
          variant="secondary"
          size="lg"
          full
          disabled={running}
          onClick={() => inputRef.current?.click()}
        >
          <FileIcon className="size-5" />
          {fileName ? "Escolher outro arquivo" : "Escolher arquivo"}
        </Button>
        {error ? <Alert>{error}</Alert> : null}
      </Card>

      {items.length > 0 ? (
        <Card className="animate-rise space-y-4 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-semibold tracking-tight">
              {`${items.length} ${items.length === 1 ? "link" : "links"}`}
            </h2>
            <span className="truncate text-sm text-muted">{fileName}</span>
          </div>
          {truncated > 0 ? (
            <p className="text-sm text-faint">{`${truncated} links além do limite de ${MAX_BATCH_LINKS} ficaram de fora.`}</p>
          ) : null}

          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[var(--color-accent)]"
              checked={queue}
              disabled={running}
              onChange={(event) => setQueue(event.target.checked)}
            />
            Colocar na fila de leitura
          </label>

          <ol className="max-h-80 space-y-1 overflow-y-auto" data-testid="lote-lista">
            {items.map((item, index) => (
              <li key={`${item.url}-${index}`} className="flex items-start gap-2 text-sm">
                <StatusIcon status={item.status} />
                <div className="min-w-0 flex-1">
                  {item.status.state === "ok" ? (
                    <Link href={`/leitor/${item.status.textId}`} className="block truncate underline">
                      {item.status.title}
                    </Link>
                  ) : (
                    <p className="truncate">{item.title ?? item.url}</p>
                  )}
                  {item.title ? <p className="truncate text-xs text-faint">{item.url}</p> : null}
                  {item.status.state === "falhou" ? (
                    <p className="text-xs text-danger">{item.status.message}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          {waiting > 0 ? (
            <p className="text-sm text-muted" aria-live="polite">
              {`Limite de importações atingido. Continuando em ${waiting} s.`}
            </p>
          ) : null}

          {finished ? (
            <p className="text-sm font-medium" role="status" data-testid="lote-resumo">
              {`${done} ${done === 1 ? "importado" : "importados"}, ${failed} com falha.`}
            </p>
          ) : null}

          {running ? (
            <Button
              variant="secondary"
              size="lg"
              full
              onClick={() => {
                cancelRef.current = true;
              }}
            >
              Parar
            </Button>
          ) : (
            <Button
              size="lg"
              full
              onClick={() => void run()}
              disabled={items.every((item) => item.status.state === "ok")}
            >
              {finished && failed > 0 ? "Tentar as que falharam" : "Importar todos"}
            </Button>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function StatusIcon({ status }: { status: Status }) {
  if (status.state === "ok") return <CheckIcon className="mt-0.5 size-4 shrink-0 text-positive" />;
  if (status.state === "falhou") return <CloseIcon className="mt-0.5 size-4 shrink-0 text-danger" />;
  return (
    <span
      className={`mt-1.5 size-2 shrink-0 rounded-full ${
        status.state === "importando" ? "animate-pulse bg-accent" : "bg-border-strong"
      }`}
      aria-hidden="true"
    />
  );
}
