/**
 * Leitura sem conexao.
 *
 * Duas coisas precisam sobreviver a falta de rede: as telas ja visitadas e o
 * que foi lido enquanto elas estavam sem rede. A primeira e cache de
 * navegacao; a segunda e uma fila que o service worker esvazia ao reconectar.
 *
 * As constantes vivem aqui porque o service worker, que nao passa pelo
 * empacotador, precisa das mesmas - e um numero fora de sincronia entre os
 * dois nao apareceria ate alguem ficar offline.
 */

/**
 * Textos guardados para leitura offline.
 *
 * Vinte cobre a biblioteca recente sem encher o armazenamento do navegador:
 * a pagina do leitor traz o conteudo inteiro no HTML, entao cada uma pesa o
 * tamanho do proprio texto.
 */
export const OFFLINE_TEXTS = 20;

/** Teto do que o cache de leitura pode ocupar. */
export const OFFLINE_BUDGET_BYTES = 12 * 1024 * 1024;

/** Rotas cujo POST/PATCH pode esperar a conexao voltar. */
export const QUEUEABLE = [/^\/api\/texts\/[0-9a-f-]+$/i, /^\/api\/reading-sessions$/];

/** Verdadeiro quando a requisicao pode ser adiada em vez de falhar. */
export function queueable(pathname: string, method: string): boolean {
  if (method !== "PATCH" && method !== "POST") return false;
  return QUEUEABLE.some((pattern) => pattern.test(pathname));
}

/**
 * Qual das duas posicoes vale.
 *
 * O criterio 3 da US-40 pede a mais recente, nao a maior: um texto relido do
 * inicio em outro aparelho precisa voltar ao inicio aqui tambem. Sem data de
 * um dos lados, a que tem data ganha - ela veio de quem sabia quando.
 */
export function newerPosition(
  local: { progressIndex: number; at?: string | null },
  remote: { progressIndex: number; at?: string | null }
): number {
  const localAt = Date.parse(local.at ?? "");
  const remoteAt = Date.parse(remote.at ?? "");

  if (Number.isNaN(localAt) && Number.isNaN(remoteAt)) return remote.progressIndex;
  if (Number.isNaN(localAt)) return remote.progressIndex;
  if (Number.isNaN(remoteAt)) return local.progressIndex;

  return localAt >= remoteAt ? local.progressIndex : remote.progressIndex;
}

/** Acoes que exigem rede e precisam avisar em vez de falhar em silencio. */
export const NEEDS_NETWORK = "Esta acao precisa de conexao.";
