"use client";

import { useState, useSyncExternalStore } from "react";
import { useToast } from "@/components/providers";
import { Button, Card, SectionTitle } from "@/components/ui";
import { CopyIcon, LinkIcon } from "@/components/icons";
import { bookmarkletUrl } from "@/lib/bookmarklet";

/** A origem nunca muda enquanto a pagina vive; nao ha o que assinar. */
const subscribeNever = () => () => {};

/**
 * Favorito do navegador e Atalho do iOS.
 *
 * O favorito le a pagina aberta no proprio navegador e envia o HTML a
 * `/api/receber` (`src/lib/bookmarklet.ts`): funciona tambem nos sites que
 * recusam a busca feita pelo servidor. O Atalho do iOS so passa o endereco a
 * `/compartilhar?url=`, que busca a pagina no servidor - e o unico caminho no
 * iPhone, onde o Safari nao implementa o alvo de compartilhamento da Web.
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

  const code = origin ? bookmarkletUrl(origin) : "";

  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(message, "success");
    } catch {
      notify("Não consegui copiar. Selecione o texto e copie à mão.", "error");
    }
  };

  return (
    <Card id="enviar" className="scroll-mt-20 space-y-4 p-5">
      <SectionTitle>Enviar a página atual</SectionTitle>
      <p className="text-sm text-muted">
        Um favorito do navegador que lê o texto aberto, e as páginas seguintes quando ele tem
        várias, e abre a prévia aqui. Funciona também nos sites que recusam a importação por link.
        Se você já tinha o favorito, troque o endereço dele pelo código novo.
      </p>

      <div className="space-y-2">
        <p className="text-sm font-medium">No Android (Chrome)</p>
        <ol className="space-y-1.5 text-sm text-muted">
          <li>1. Toque em &ldquo;Copiar o código&rdquo;, abaixo.</li>
          <li>2. Adicione esta página aos favoritos: menu (três pontos) e a estrela.</li>
          <li>
            3. Edite o favorito criado: nome &ldquo;Enviar para o Leitura&rdquo; e, no endereço,
            apague tudo e cole o código.
          </li>
          <li>
            4. Com o texto aberto, toque na barra de endereço, digite &ldquo;Enviar&rdquo; e
            escolha o favorito na lista. Aberto pela tela de Favoritos ele não roda.
          </li>
        </ol>
        <Button full onClick={() => void copy(code, "Código copiado.")} disabled={!code}>
          <CopyIcon className="size-4" />
          Copiar o código
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">No computador</p>
        <p className="text-sm text-muted">
          Arraste o botão abaixo para a barra de favoritos. Em qualquer página, um clique nele
          abre a prévia do texto aqui.
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
          O Safari não oferece o Leitura na lista de compartilhamento. Crie um Atalho, que envia
          o endereço para o app buscar a página (sites que recusam o app não funcionam por aqui):
        </p>
        <ol className="space-y-1.5 text-sm text-muted">
          <li>1. Abra o app Atalhos e crie um atalho novo.</li>
          <li>
            2. Em Informações, ligue &ldquo;Mostrar na Folha de Compartilhamento&rdquo; e aceite
            apenas URLs.
          </li>
          <li>
            3. Adicione a ação &ldquo;Abrir URL&rdquo; com o endereço abaixo, colando a Entrada
            do Atalho no lugar indicado.
          </li>
        </ol>

        <button
          type="button"
          onClick={() => void copy(`${origin}/compartilhar?url=`, "Endereço copiado.")}
          className="break-anywhere w-full rounded-xl bg-surface-2 p-3 text-left font-mono text-xs"
        >
          {origin ? `${origin}/compartilhar?url=` : "…"}
          <span className="text-muted">[Entrada do Atalho]</span>
        </button>
        <p className="text-sm text-faint">
          Depois, em qualquer página do Safari: Compartilhar, e escolha o atalho.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Button variant="secondary" full onClick={() => setShowCode(!showCode)}>
          {showCode ? "Esconder o código do favorito" : "Ver o código do favorito"}
        </Button>

        {showCode ? (
          <p className="break-anywhere max-h-48 overflow-y-auto rounded-xl bg-surface-2 p-3 font-mono text-xs">
            {code}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
