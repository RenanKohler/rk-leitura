"use client";

import { useState, useSyncExternalStore } from "react";
import { useToast } from "@/components/providers";
import { Button, Card, SectionTitle } from "@/components/ui";
import { CopyIcon, LinkIcon } from "@/components/icons";

/** A origem nunca muda enquanto a pagina vive; nao ha o que assinar. */
const subscribeNever = () => () => {};

/**
 * Favorito do navegador e Atalho do iOS.
 *
 * `/compartilhar?url=` ja recebe um endereco e faz todo o resto, inclusive a
 * confirmacao exigida quando a navegacao vem de outro site. O que falta e o
 * gatilho - e ele e o unico caminho no iPhone, onde o Safari nao implementa
 * o alvo de compartilhamento da Web.
 */
export function BookmarkletCard() {
  const notify = useToast();
  // A origem so existe no navegador. Ler assim em vez de gravar em estado
  // dentro de um efeito: o valor e do ambiente, nao da tela, e no servidor o
  // HTML sai com o campo vazio em vez de divergir da primeira renderizacao.
  const origin = useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    () => ""
  );
  const [showCode, setShowCode] = useState(false);

  const code = origin
    ? `javascript:void(open('${origin}/compartilhar?url='+encodeURIComponent(location.href)))`
    : "";

  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(message, "success");
    } catch {
      notify("Nao consegui copiar. Selecione o texto e copie a mao.", "error");
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <SectionTitle>Enviar a pagina atual</SectionTitle>

      <div className="space-y-2">
        <p className="text-sm font-medium">No computador</p>
        <p className="text-sm text-muted">
          Arraste o botao abaixo para a barra de favoritos. Em qualquer pagina, um clique nele
          abre a importacao aqui com o endereco ja preenchido.
        </p>
        {/* Arrastar um link e a unica forma de criar um favorito: nenhuma API
            do navegador permite adicionar um por conta propria. */}
        {code ? (
          <a
            // O endereco e escrito direto no elemento: o React recusa `href`
            // com `javascript:` e o substitui por um erro, e e exatamente
            // isso que um favorito precisa ser.
            ref={(element) => element?.setAttribute("href", code)}
            onClick={(event) => event.preventDefault()}
            draggable
            className="inline-flex min-h-11 cursor-grab items-center gap-2 rounded-full border border-border bg-surface-2 px-4 text-sm font-medium active:cursor-grabbing"
          >
            <LinkIcon className="size-4" />
            Enviar para o Leitura
          </a>
        ) : null}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">No iPhone</p>
        <p className="text-sm text-muted">
          O Safari nao oferece o Leitura na lista de compartilhamento. Crie um Atalho:
        </p>
        <ol className="space-y-1.5 text-sm text-muted">
          <li>1. Abra o app Atalhos e crie um atalho novo.</li>
          <li>
            2. Em Informacoes, ligue &ldquo;Mostrar na Folha de Compartilhamento&rdquo; e aceite
            apenas URLs.
          </li>
          <li>
            3. Adicione a acao &ldquo;Abrir URL&rdquo; com o endereco abaixo, colando a Entrada
            do Atalho no lugar indicado.
          </li>
        </ol>

        <button
          type="button"
          onClick={() => void copy(`${origin}/compartilhar?url=`, "Endereco copiado.")}
          className="break-anywhere w-full rounded-xl bg-surface-2 p-3 text-left font-mono text-xs"
        >
          {origin ? `${origin}/compartilhar?url=` : "…"}
          <span className="text-faint">[Entrada do Atalho]</span>
        </button>
        <p className="text-sm text-faint">
          Depois, em qualquer pagina do Safari: Compartilhar, e escolha o atalho.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Button variant="secondary" full onClick={() => setShowCode(!showCode)}>
          {showCode ? "Esconder o codigo do favorito" : "Ver o codigo do favorito"}
        </Button>

        {showCode ? (
          <>
            <p className="break-anywhere rounded-xl bg-surface-2 p-3 font-mono text-xs">{code}</p>
            <Button variant="secondary" full onClick={() => void copy(code, "Codigo copiado.")}>
              <CopyIcon className="size-4" />
              Copiar o codigo
            </Button>
          </>
        ) : null}
      </div>
    </Card>
  );
}
