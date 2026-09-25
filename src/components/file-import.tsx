"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Alert, Button, Card, Field } from "@/components/ui";
import { CheckIcon, FileIcon } from "@/components/icons";
import { countWords, formatNumber, parseParagraphs, type TextFormat } from "@/lib/reading";
import { markdownTitle } from "@/lib/markdown";
import {
  fileTitle,
  hasNoText,
  MAX_IMPORT_CHARS,
  MAX_PDF_BYTES,
  usableMetaTitle,
} from "@/lib/pdf-text";
import {
  chapterText,
  chapterTitle,
  EpubError,
  MAX_EPUB_BYTES,
  MIN_CHAPTER_WORDS,
  baseDir,
  opfPath,
  parseOpf,
  parseToc,
  resolvePath,
} from "@/lib/epub-text";
import type { TextDetail } from "@/lib/types";

/** Markdown e texto puro: o limite e o mesmo do conteudo aceito pelo servidor. */
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MARKDOWN_FILE = /\.(md|markdown)$/i;

interface Chapter {
  title: string;
  content: string;
  words: number;
  chosen: boolean;
}

/**
 * Importacao de arquivo: PDF, EPUB e Markdown.
 *
 * A leitura acontece no navegador. Mandar um PDF de dez megabytes para uma
 * funcao serverless esbarraria no limite de corpo e no de tempo, e guardar o
 * arquivo ampliaria a superficie de dados do app - aqui so o texto extraido
 * chega ao servidor, como em qualquer outra importacao.
 */
export function FileImport() {
  const router = useRouter();
  const notify = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<TextFormat>("plain");
  const [truncated, setTruncated] = useState(false);
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [bookTitle, setBookTitle] = useState("");
  // `dc:language` do livro, repassado a cada capitulo salvo (US-67).
  const [bookLanguage, setBookLanguage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setError("");
    setTitle("");
    setContent("");
    setFormat("plain");
    setTruncated(false);
    setChapters(null);
    setBookTitle("");
    setBookLanguage(null);
  };

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setBusy(true);
    try {
      if (/\.epub$/i.test(file.name)) await readEpub(file);
      else if (MARKDOWN_FILE.test(file.name) || file.type === "text/markdown") {
        await readMarkdown(file);
      } else await readPdf(file);
    } catch (cause) {
      setError(
        cause instanceof EpubError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "Nao consegui ler o arquivo."
      );
    } finally {
      setBusy(false);
      setProgress("");
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const readPdf = async (file: File) => {
    if (file.size > MAX_PDF_BYTES) {
      throw new Error(`O PDF passa de ${Math.round(MAX_PDF_BYTES / 1024 / 1024)} MB.`);
    }

    setProgress("Abrindo o PDF");
    const { extractPdf } = await import("@/lib/pdf-client");
    const result = await extractPdf(file, (page, total) =>
      setProgress(`Lendo pagina ${page} de ${total}`)
    );

    if (hasNoText(result.content)) {
      throw new Error(
        "Este PDF nao tem texto extraivel. Provavelmente e digitalizado, e so imagem."
      );
    }

    // O extrator entrega Markdown: colunas na ordem de leitura e titulos
    // marcados como titulos.
    const long = result.content.length > MAX_IMPORT_CHARS;
    setTruncated(long);
    setFormat("markdown");
    setContent(long ? result.content.slice(0, MAX_IMPORT_CHARS) : result.content);
    setTitle(
      usableMetaTitle(result.title) ?? markdownTitle(result.content) ?? fileTitle(null, file.name)
    );
  };

  const readMarkdown = async (file: File) => {
    if (file.size > MAX_MARKDOWN_BYTES) {
      throw new Error(`O arquivo passa de ${Math.round(MAX_MARKDOWN_BYTES / 1024 / 1024)} MB.`);
    }

    const source = (await file.text()).replace(/^\uFEFF/, "");
    if (countWords(source, "markdown") === 0) {
      throw new Error("Este arquivo nao tem texto para ler.");
    }

    const long = source.length > MAX_IMPORT_CHARS;
    setTruncated(long);
    setFormat("markdown");
    setContent(long ? source.slice(0, MAX_IMPORT_CHARS) : source);
    setTitle(markdownTitle(source) ?? fileTitle(null, file.name));
  };

  const readEpub = async (file: File) => {
    if (file.size > MAX_EPUB_BYTES) {
      throw new EpubError(`O EPUB passa de ${Math.round(MAX_EPUB_BYTES / 1024 / 1024)} MB.`);
    }

    setProgress("Abrindo o livro");
    const JSZip = (await import("jszip")).default;

    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch {
      throw new EpubError("Nao consegui abrir o arquivo. Ele pode estar corrompido.");
    }

    // Um EPUB protegido traz este arquivo; o conteudo nem chega a ser lido.
    if (zip.file("META-INF/encryption.xml")) {
      throw new EpubError("Este EPUB tem protecao de copia e nao pode ser importado.");
    }

    const container = await zip.file("META-INF/container.xml")?.async("string");
    if (!container) throw new EpubError("Este arquivo nao parece um EPUB valido.");

    const opf = opfPath(container);
    const base = baseDir(opf);
    const opfXml = await zip.file(opf)?.async("string");
    if (!opfXml) throw new EpubError("Este arquivo nao parece um EPUB valido.");

    const index = parseOpf(opfXml, base);

    // Sumario: so para dar nome aos capitulos.
    const tocFile =
      zip.file(/\.ncx$/i)[0] ??
      zip.file(new RegExp(`${base}nav\\.x?html$`, "i"))[0] ??
      zip.file(/nav\.x?html$/i)[0];
    const titles = tocFile ? parseToc(await tocFile.async("string"), base) : new Map();

    const found: Chapter[] = [];
    for (const [position, href] of index.spine.entries()) {
      setProgress(`Lendo capitulo ${position + 1} de ${index.spine.length}`);
      const xhtml = await zip.file(href)?.async("string");
      if (!xhtml) continue;

      const body = chapterText(xhtml);
      const words = countWords(body);
      // Capa, creditos e sumario entram no spine e nao sao leitura.
      if (words < MIN_CHAPTER_WORDS) continue;

      found.push({
        title: titles.get(href) ?? chapterTitle(xhtml, `Parte ${found.length + 1}`),
        content: body.slice(0, MAX_IMPORT_CHARS),
        words,
        chosen: true,
      });
    }

    if (found.length === 0) {
      throw new EpubError("Nao encontrei capitulos com texto neste EPUB.");
    }

    setBookTitle(index.title);
    setBookLanguage(index.language);
    setChapters(found);
  };

  const saveSingle = async () => {
    if (!title.trim() || !content) return;
    setSaving(true);
    try {
      const { text } = await apiSend<{ text: TextDetail }>("/api/texts", "POST", {
        title: title.trim(),
        content,
        format,
      });
      notify("Texto salvo.", "success");
      router.replace(`/leitor/${text.id}`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Falha ao salvar.", "error");
      setSaving(false);
    }
  };

  const saveBook = async () => {
    if (!chapters) return;
    const chosen = chapters.filter((chapter) => chapter.chosen);
    if (chosen.length === 0) return;

    setSaving(true);
    try {
      // Um capitulo por vez, na ordem: o vinculo de serie depende dela, e uma
      // falha no meio deixa os anteriores salvos em vez de perder tudo.
      let first: string | null = null;
      for (const [position, chapter] of chosen.entries()) {
        setProgress(`Salvando ${position + 1} de ${chosen.length}`);
        const { text } = await apiSend<{ text: TextDetail }>("/api/texts", "POST", {
          // O capitulo mantem o proprio nome; a sequencia vai declarada, em
          // vez de embutida no titulo so para a deteccao funcionar.
          title: chapter.title,
          content: chapter.content,
          tags: [bookTitle.slice(0, 30)],
          series: { title: bookTitle, chapter: position + 1 },
          language: bookLanguage,
        });
        first ??= text.id;
      }

      notify(`${chosen.length} capitulos salvos.`, "success");
      router.replace(first ? `/leitor/${first}` : "/textos");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Falha ao salvar.", "error");
      setSaving(false);
      setProgress("");
    }
  };

  // A previa mostra o texto como sera lido, sem as marcas de formatacao.
  const preview = useMemo(
    () =>
      parseParagraphs(content.slice(0, 5_000), format)
        .paragraphs.map((paragraph) => paragraph.words.join(" "))
        .join("\n\n"),
    [content, format]
  );

  const chosenCount = chapters?.filter((chapter) => chapter.chosen).length ?? 0;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.epub,.md,.markdown,application/pdf,application/epub+zip,text/markdown"
          className="sr-only"
          onChange={(event) => void onPick(event.target.files?.[0])}
        />

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border-strong px-4 py-6 text-center transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          <FileIcon className="size-7 text-muted" />
          <span className="font-medium">{busy ? progress || "Lendo" : "Escolher arquivo"}</span>
          <span className="text-sm text-muted">
            {`PDF com texto selecionavel ate ${Math.round(MAX_PDF_BYTES / 1024 / 1024)} MB, EPUB sem protecao ou Markdown (.md)`}
          </span>
        </button>
      </Card>

      {error ? <Alert>{error}</Alert> : null}

      {truncated ? (
        <Alert tone="positive">
          O documento passa do tamanho maximo. Vamos importar o trecho inicial, de{" "}
          {formatNumber(countWords(content, format))} palavras.
        </Alert>
      ) : null}

      {content ? (
        <Card className="space-y-4 p-4">
          <Field
            label="Titulo"
            name="titulo-arquivo"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div>
            <p className="text-sm font-medium text-muted">Previa</p>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted">
              {preview.slice(0, 500)}
              {preview.length > 500 ? "…" : ""}
            </p>
          </div>
          <p className="tabular text-sm text-faint">
            {`${formatNumber(countWords(content, format))} palavras`}
          </p>
          <Button size="lg" full loading={saving} disabled={!title.trim()} onClick={() => void saveSingle()}>
            Salvar na biblioteca
          </Button>
        </Card>
      ) : null}

      {chapters ? (
        <Card className="space-y-4 p-4">
          <Field
            label="Titulo do livro"
            name="titulo-livro"
            value={bookTitle}
            onChange={(event) => setBookTitle(event.target.value)}
          />

          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted">
                {`${chapters.length} capitulos`}
              </p>
              <button
                type="button"
                onClick={() =>
                  setChapters(
                    chapters.map((chapter) => ({ ...chapter, chosen: chosenCount < chapters.length }))
                  )
                }
                className="min-h-9 text-sm font-medium text-accent"
              >
                {chosenCount < chapters.length ? "Marcar todos" : "Desmarcar todos"}
              </button>
            </div>

            <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto">
              {chapters.map((chapter, index) => (
                <li key={index}>
                  <button
                    type="button"
                    aria-pressed={chapter.chosen}
                    onClick={() =>
                      setChapters(
                        chapters.map((item, position) =>
                          position === index ? { ...item, chosen: !item.chosen } : item
                        )
                      )
                    }
                    className={`flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                      chapter.chosen ? "border-accent bg-accent-soft" : "border-border"
                    }`}
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center">
                      {chapter.chosen ? <CheckIcon className="size-4 text-accent" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{chapter.title}</span>
                    <span className="tabular shrink-0 text-xs text-faint">
                      {formatNumber(chapter.words)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <Button
            size="lg"
            full
            loading={saving}
            disabled={chosenCount === 0 || !bookTitle.trim()}
            onClick={() => void saveBook()}
          >
            {saving && progress
              ? progress
              : chosenCount === chapters.length
                ? "Importar o livro inteiro"
                : `Importar ${chosenCount} ${chosenCount === 1 ? "capitulo" : "capitulos"}`}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
