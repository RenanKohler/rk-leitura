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

/**
 * O que fazer com um envio adiado depois da resposta do servidor (US-171).
 *
 * - `"enviada"`: o servidor gravou; sai da fila.
 * - `"manter"`: falha passageira ou sessao expirada (401, 408, 429, 5xx);
 *   continua na fila e e reenviada depois - no 401, quando o mesmo dono
 *   entrar de novo (US-175).
 * - `"descartar"`: o servidor recusou o conteudo (400, 403, 404, 409 e os
 *   demais 4xx); repetir nao muda a resposta.
 *
 * O `sw.js` tem a mesma regra em `RETRY_STATUS`; um teste compara os dois.
 */
export const RETRY_STATUS = [401, 408, 429];

export type QueueDisposition = "enviada" | "manter" | "descartar";

export function queueDisposition(status: number): QueueDisposition {
  if (status >= 200 && status < 300) return "enviada";
  if (status >= 500 || RETRY_STATUS.includes(status)) return "manter";
  return "descartar";
}

/** Falhas seguidas de gravacao ate o leitor ser avisado. */
export const SAVE_FAILURES_BEFORE_NOTICE = 3;

export const SAVE_FAILURE_NOTICE =
  "Não foi possível salvar o progresso. Vamos tentar de novo quando a conexão voltar.";

/**
 * Gravacoes do leitor que ainda nao chegaram ao servidor (US-171).
 *
 * Sem service worker (ou antes de ele assumir a pagina), uma sessao que
 * falhava era perdida: o `fetch` engolia o erro. Aqui ela fica guardada em
 * memoria e volta a ser enviada quando a rede volta ou na proxima gravacao
 * que der certo. Conta as falhas seguidas para o aviso na tela.
 */
export function createSaveRetry(
  send: (body: string, keepalive: boolean) => Promise<Response>,
  onFailingChange: (failing: boolean) => void
) {
  let failures = 0;
  const pending: string[] = [];

  const succeeded = () => {
    if (failures >= SAVE_FAILURES_BEFORE_NOTICE) onFailingChange(false);
    failures = 0;
  };
  const failed = () => {
    failures += 1;
    if (failures === SAVE_FAILURES_BEFORE_NOTICE) onFailingChange(true);
  };

  /** Envia; devolve a resposta quando o servidor gravou, ou null. */
  async function post(body: string, keepalive = false): Promise<Response | null> {
    let response: Response;
    try {
      response = await send(body, keepalive);
    } catch {
      pending.push(body);
      failed();
      return null;
    }
    const disposition = queueDisposition(response.status);
    if (disposition === "enviada") {
      succeeded();
      return response;
    }
    if (disposition === "manter") pending.push(body);
    failed();
    return null;
  }

  /** Reenvia o que ficou pendente, na ordem em que foi gerado. */
  async function retry(): Promise<void> {
    const items = pending.splice(0);
    for (const body of items) await post(body);
  }

  return {
    post,
    retry,
    succeeded,
    failed,
    pendingCount: () => pending.length,
  };
}

/** Acoes que exigem rede e precisam avisar em vez de falhar em silencio. */
export const NEEDS_NETWORK = "Esta ação precisa de conexão.";
