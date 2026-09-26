"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Button, Card, Field, Segmented } from "@/components/ui";
import { BackIcon, FileIcon, LinkIcon, TextIcon } from "@/components/icons";
import { PasteForm } from "@/components/paste-form";
import { FileImport } from "@/components/file-import";
import { formatNumber } from "@/lib/reading";
import type { ImportedText, TextDetail } from "@/lib/types";
import Link from "next/link";
import { CitationsOption } from "@/components/citations-option";

type Source = "link" | "texto" | "arquivo";

export default function NewTextPage() {
  const [source, setSource] = useState<Source>("link");

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-2 pt-2">
        <Link
          href="/textos"
          aria-label="Voltar"
          className="-ml-2 flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        >
          <BackIcon className="size-5" />
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Novo texto</h1>
      </header>

      <Segmented<Source>
        label="Origem do texto"
        value={source}
        onChange={setSource}
        options={[
          { value: "link", label: "Link", icon: <LinkIcon className="size-4" /> },
          { value: "texto", label: "Colar", icon: <TextIcon className="size-4" /> },
          { value: "arquivo", label: "Arquivo", icon: <FileIcon className="size-4" /> },
        ]}
      />

      {source === "link" ? <FromLink /> : source === "arquivo" ? <FileImport /> : <PasteForm />}
    </div>
  );
}

function FromLink() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<ImportedText | null>(null);
  const [keepCitations, setKeepCitations] = useState(false);
  const [title, setTitle] = useState("");
  const router = useRouter();
  const notify = useToast();

  const handleImport = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();

    if (!/^https?:\/\//i.test(trimmed)) {
      setError("O endereco precisa comecar com http:// ou https://");
      return;
    }

    setError("");
    setImporting(true);
    try {
      const imported = await apiSend<ImportedText>("/api/import-url", "POST", { url: trimmed });
      setPreview(imported);
      setTitle(imported.title);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao importar.");
    } finally {
      setImporting(false);
    }
  };

  const handleSave = async () => {
    if (!preview || !title.trim()) return;
    setSaving(true);
    try {
      const { text } = await apiSend<{ text: TextDetail }>("/api/texts", "POST", {
        title: title.trim(),
        sourceUrl: preview.sourceUrl,
        content: preview.content,
        language: preview.language,
        keepCitations,
      });
      notify("Texto salvo.", "success");
      router.replace(`/leitor/${text.id}`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Falha ao salvar.", "error");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form onSubmit={handleImport} className="space-y-4">
          <Field
            label="Endereco do artigo"
            name="url"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://site.com/artigo"
            hint="Extraimos o texto principal da pagina, sem menus e anuncios."
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            error={error || undefined}
          />
          <Button type="submit" size="lg" full loading={importing} disabled={!url.trim()}>
            {importing ? "Buscando a pagina" : "Importar"}
          </Button>
        </form>
      </Card>

      {preview ? (
        <Card className="animate-rise space-y-4 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-semibold tracking-tight">Conferir e salvar</h2>
            <span className="text-sm text-muted">{formatNumber(preview.wordCount)} palavras</span>
          </div>

          <Field
            label="Titulo"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-muted">Previa do conteudo</p>
            <div className="max-h-64 overflow-y-auto rounded-2xl border border-border bg-bg p-4 text-sm leading-relaxed text-muted">
              {preview.content.slice(0, 2000)}
              {preview.content.length > 2000 ? "..." : ""}
            </div>
          </div>

          <CitationsOption content={preview.content} keep={keepCitations} onChange={setKeepCitations} />

          <Button size="lg" full loading={saving} onClick={handleSave} disabled={!title.trim()}>
            Salvar e ler
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
