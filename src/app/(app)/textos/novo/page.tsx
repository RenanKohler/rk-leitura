"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Button, Card, Field, Segmented } from "@/components/ui";
import { BackIcon, FileIcon, LinkIcon, QueueIcon, TextIcon } from "@/components/icons";
import { PasteForm } from "@/components/paste-form";
import { FileImport } from "@/components/file-import";
import { BatchImport } from "@/components/batch-import";
import { countWords, formatNumber } from "@/lib/reading";
import type { ImportedText, TagSummary, TextDetail } from "@/lib/types";
import Link from "next/link";
import { CitationsOption } from "@/components/citations-option";
import { TagPicker } from "@/components/tag-picker";
import { ImportPreviewContent } from "@/components/import-preview";
import { useAiConsent } from "@/components/ai-consent";
import { applyRemovals, UNTITLED, type Leftover } from "@/lib/import-analysis";
import { SuggestedField, type SuggestedMeta } from "@/components/suggested-field";

/** Resposta de POST /api/import-url/analise (US-136, US-137 e US-152). */
interface ImportAnalysis extends Partial<SuggestedMeta> {
  leftovers: Leftover[];
  suggestedTags: string[];
}

type Source = "link" | "texto" | "arquivo" | "lote";

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
          // Lote (PROD-17): a lista de links exportada de outro servico.
          { value: "lote", label: "Lote", icon: <QueueIcon className="size-4" /> },
        ]}
      />

      {source === "link" ? (
        <FromLink />
      ) : source === "arquivo" ? (
        <FileImport />
      ) : source === "lote" ? (
        <BatchImport />
      ) : (
        <PasteForm />
      )}
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
  const [author, setAuthor] = useState("");
  // Campos que vieram da IA e ainda nao foram mexidos (US-152).
  const [suggested, setSuggested] = useState({ title: false, author: false });
  // O que a pessoa digitou vale: a sugestao que volta depois nao sobrescreve.
  const touched = useRef({ title: false, author: false });
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [chosenTags, setChosenTags] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  // Paragrafos marcados como resto que a pessoa decidiu manter (US-136).
  const [kept, setKept] = useState<ReadonlySet<number>>(new Set());
  // Cada importacao invalida a analise da anterior que ainda nao voltou.
  const attempt = useRef(0);
  const { state: consent } = useAiConsent();
  const router = useRouter();
  const notify = useToast();

  const leftovers = analysis?.leftovers ?? [];
  const removed = leftovers.map((item) => item.index).filter((index) => !kept.has(index));
  const finalContent = preview ? applyRemovals(preview.content, removed) : "";
  const finalWords = preview && removed.length > 0 ? countWords(finalContent) : preview?.wordCount ?? 0;

  /**
   * Etiquetas da conta para o seletor e, com a IA permitida, a analise da
   * previa. A previa ja esta na tela: a analise so acrescenta marcacoes e
   * sugestoes quando volta, e qualquer falha deixa tudo como estava.
   */
  const enrich = async (imported: ImportedText, id: number) => {
    let known: string[] = [];
    try {
      const { tags } = await apiGet<{ tags: TagSummary[] }>("/api/etiquetas");
      known = tags.map((tag) => tag.name);
    } catch {
      // Sem a lista o seletor so cria etiquetas novas.
    }
    if (attempt.current !== id) return;
    setKnownTags(known);

    // Sem permissao nada sai do app: a previa fica como sempre foi.
    if (consent !== "on") return;
    // Titulo e autor (US-152) vao na chamada da limpeza. Sozinhos, so quando
    // a pagina nao trouxe titulo; o autor ausente pega carona na limpeza.
    const needsTitle = !imported.title.trim() || imported.title === UNTITLED;
    const meta = needsTitle || (imported.extraction === "palpite" && !imported.author);
    if (imported.extraction !== "palpite" && known.length === 0 && !meta) return;

    setAnalyzing(true);
    try {
      const result = await apiSend<ImportAnalysis>("/api/import-url/analise", "POST", {
        title: imported.title,
        content: imported.content,
        extraction: imported.extraction,
        meta,
      });
      if (attempt.current !== id) return;
      setAnalysis(result);
      if (needsTitle && result.suggestedTitle && !touched.current.title) {
        setTitle(result.suggestedTitle);
        setSuggested((current) => ({ ...current, title: true }));
      }
      if (!imported.author && result.suggestedAuthor && !touched.current.author) {
        setAuthor(result.suggestedAuthor);
        setSuggested((current) => ({ ...current, author: true }));
      }
    } catch {
      // Analise e acessorio: falhou, a previa segue sem marcacoes.
    } finally {
      if (attempt.current === id) setAnalyzing(false);
    }
  };

  const handleImport = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();

    if (!/^https?:\/\//i.test(trimmed)) {
      setError("O endereço precisa começar com http:// ou https://");
      return;
    }

    setError("");
    setImporting(true);
    const id = ++attempt.current;
    setAnalysis(null);
    setAnalyzing(false);
    setKept(new Set());
    setChosenTags([]);
    setSuggested({ title: false, author: false });
    touched.current = { title: false, author: false };
    try {
      const imported = await apiSend<ImportedText>("/api/import-url", "POST", { url: trimmed });
      setPreview(imported);
      setTitle(imported.title);
      setAuthor(imported.author ?? "");
      void enrich(imported, id);
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
        author: author.trim() || null,
        sourceUrl: preview.sourceUrl,
        // O texto extraido sem os restos removidos; o resto, intacto.
        content: finalContent,
        language: preview.language,
        keepCitations,
        tags: chosenTags,
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
            label="Endereço do artigo"
            name="url"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://site.com/artigo"
            hint="Extraímos o texto principal da página, sem menus e anúncios."
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            error={error || undefined}
          />
          <Button type="submit" size="lg" full loading={importing} disabled={!url.trim()}>
            {importing ? "Buscando a página" : "Importar"}
          </Button>
        </form>
      </Card>

      {preview ? (
        <Card className="animate-rise space-y-4 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-semibold tracking-tight">Conferir e salvar</h2>
            <span className="text-sm text-muted">{formatNumber(finalWords)} palavras</span>
          </div>

          <SuggestedField
            label="Título"
            name="title"
            value={title}
            suggested={suggested.title}
            onChange={(value) => {
              touched.current.title = true;
              setSuggested((current) => ({ ...current, title: false }));
              setTitle(value);
            }}
          />
          <SuggestedField
            label="Autor"
            name="author"
            value={author}
            placeholder="Opcional"
            suggested={suggested.author}
            onChange={(value) => {
              touched.current.author = true;
              setSuggested((current) => ({ ...current, author: false }));
              setAuthor(value);
            }}
          />

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-muted">Prévia do conteúdo</p>
              {analyzing ? (
                <span className="text-xs text-faint" role="status">
                  Conferindo a página...
                </span>
              ) : removed.length > 0 ? (
                <span className="text-xs text-faint">
                  {removed.length === 1
                    ? "1 parágrafo fica de fora"
                    : `${removed.length} parágrafos ficam de fora`}
                </span>
              ) : null}
            </div>
            <ImportPreviewContent
              content={preview.content}
              leftovers={leftovers}
              kept={kept}
              onToggle={(index) =>
                setKept((current) => {
                  const next = new Set(current);
                  if (next.has(index)) next.delete(index);
                  else next.add(index);
                  return next;
                })
              }
            />
          </div>

          <TagPicker
            known={knownTags}
            value={chosenTags}
            onChange={setChosenTags}
            suggested={analysis?.suggestedTags ?? []}
          />

          <CitationsOption content={finalContent} keep={keepCitations} onChange={setKeepCitations} />

          <Button size="lg" full loading={saving} onClick={handleSave} disabled={!title.trim()}>
            Salvar e ler
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
