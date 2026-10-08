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

/**
 * Janela em que o `at` do cliente conta como "agora".
 *
 * Um save feito com rede chega segundos depois de escrito; um que ficou na
 * fila offline chega minutos ou horas depois. Cinco minutos cobrem relogios
 * de aparelho um pouco fora de hora sem confundir os dois casos.
 */
export const LIVE_SAVE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Decide se um save de posicao vence o que o servidor ja tem.
 *
 * `newerPosition` compara o `at` do cliente com o `updatedAt` gravado, e os
 * dois vem de relogios diferentes: o do aparelho e o do servidor. Um celular
 * com o relogio dez minutos atrasado tinha todo save descartado em silencio,
 * porque o `at` dele sempre parecia mais velho que a ultima gravacao.
 *
 * Sem uma coluna com o ultimo `at` de cliente aceito, a regra passa a ser:
 * - sem `at`, ou com `at` perto da hora do servidor: e um save feito agora,
 *   com rede, e vence - a hora dele e a do servidor;
 * - com `at` bem mais antigo: veio da fila offline, e so vence se for mais
 *   recente que a ultima gravacao (US-40, criterio 3).
 */
export function acceptsPosition(
  clientAt: string | null | undefined,
  storedAt: Date | string,
  serverNow: Date = new Date()
): boolean {
  const at = Date.parse(clientAt ?? "");
  if (Number.isNaN(at)) return true;
  if (Math.abs(serverNow.getTime() - at) < LIVE_SAVE_WINDOW_MS) return true;

  const stored = storedAt instanceof Date ? storedAt.getTime() : Date.parse(storedAt);
  if (Number.isNaN(stored)) return true;
  return at >= stored;
}

/** Acoes que exigem rede e precisam avisar em vez de falhar em silencio. */
export const NEEDS_NETWORK = "Esta ação precisa de conexão.";
