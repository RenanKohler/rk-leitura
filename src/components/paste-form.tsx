"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Alert, Button, Card, Field, TextArea } from "@/components/ui";
import { countWords, formatNumber } from "@/lib/reading";
import type { TextDetail } from "@/lib/types";

const MIN_WORDS = 10;

/**
 * Formulario de texto colado.
 *
 * Fica fora da tela de "novo texto" porque o compartilhamento do sistema usa o
 * mesmo formulario: quando a origem manda uma selecao em vez de um link, o
 * conteudo ja chega preenchido aqui.
 */
export function PasteForm({
  initialTitle = "",
  initialContent = "",
}: {
  initialTitle?: string;
  initialContent?: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const notify = useToast();

  const wordCount = countWords(content);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();

    if (wordCount < MIN_WORDS) {
      setError(`Cole um texto com pelo menos ${MIN_WORDS} palavras.`);
      return;
    }

    setError("");
    setSaving(true);
    try {
      const { text } = await apiSend<{ text: TextDetail }>("/api/texts", "POST", {
        title: title.trim() || content.trim().split(/\s+/).slice(0, 6).join(" "),
        content: content.trim(),
      });
      notify("Texto salvo.", "success");
      router.replace(`/leitor/${text.id}`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Falha ao salvar.", "error");
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      <form onSubmit={handleSave} className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}

        <Field
          label="Titulo"
          name="title"
          placeholder="Opcional - usamos o inicio do texto se ficar vazio"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />

        <TextArea
          label="Texto"
          name="content"
          rows={12}
          placeholder="Cole aqui o conteudo que quer ler."
          hint={wordCount > 0 ? `${formatNumber(wordCount)} palavras` : undefined}
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />

        <Button type="submit" size="lg" full loading={saving} disabled={wordCount === 0}>
          Salvar e ler
        </Button>
      </form>
    </Card>
  );
}
