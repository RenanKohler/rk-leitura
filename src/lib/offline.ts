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

/**
 * Endereco do service worker com a versao do build (US-176). Um endereco
 * novo instala um worker novo, que da a versao ao nome dos caches e apaga os
 * da anterior ao ativar.
 */
export function serviceWorkerUrl(buildId: string | undefined): string {
  return `/sw.js?v=${encodeURIComponent(buildId || "dev")}`;
}

/**
 * Aviso de um texto que ainda nao foi aberto com rede depois de uma
 * atualizacao: a copia antiga saiu com o cache da versao anterior (US-176).
 */
export const READER_OUTDATED = "Abra este texto com conexão para atualizá-lo.";

/**
 * Rotas cujo POST/PATCH pode esperar a conexao voltar: posicao, sessoes e,
 * desde a US-177, criar um destaque e mudar a nota de um.
 */
export const QUEUEABLE = [
  /^\/api\/texts\/[0-9a-f-]+$/i,
  /^\/api\/reading-sessions$/,
  /^\/api\/texts\/[0-9a-f-]{36}\/destaques(\/[0-9a-f-]{36})?$/i,
];

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

/* --- posicao guardada no aparelho (US-173) -------------------------------- */

/** Prefixo das posicoes locais; sair da conta apaga todas. */
export const LOCAL_POSITION_PREFIX = "leitura-posicao:";

/**
 * Chave da posicao local de um texto. Leva o id da conta: outra conta no
 * mesmo aparelho nunca le a posicao da anterior (criterio 3).
 */
export function localPositionKey(userId: string, textId: string): string {
  return `${LOCAL_POSITION_PREFIX}${userId}:${textId}`;
}

/** Posicao gravada no aparelho a cada salvamento, com ou sem rede. */
export interface LocalPosition {
  progressIndex: number;
  at: string;
  /** Palavras do texto quando a posicao foi gravada. */
  words: number;
}

/** Apaga as posicoes locais de todas as contas: sair da conta leva junto. */
export function clearLocalPositions(storage: Pick<Storage, "length" | "key" | "removeItem">): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(LOCAL_POSITION_PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

export function parseLocalPosition(raw: string | null): LocalPosition | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LocalPosition>;
    if (
      !Number.isInteger(value.progressIndex) ||
      !Number.isInteger(value.words) ||
      typeof value.at !== "string" ||
      Number.isNaN(Date.parse(value.at))
    ) {
      return null;
    }
    return { progressIndex: value.progressIndex!, at: value.at, words: value.words! };
  } catch {
    return null;
  }
}

/**
 * Onde o leitor abre (US-173): a posicao do HTML, que pode ser a da ultima
 * visita com rede, ou a do aparelho, se for mais recente (`newerPosition`).
 * A local so vale para o mesmo conteudo - texto editado desde entao abre na
 * posicao do servidor. Devolve null quando a do HTML vale.
 */
export function openingPosition(
  server: { progressIndex: number; updatedAt: string; wordCount: number },
  local: LocalPosition | null
): number | null {
  if (!local || local.words !== server.wordCount) return null;
  const chosen = newerPosition(local, { progressIndex: server.progressIndex, at: server.updatedAt });
  return chosen === server.progressIndex ? null : Math.min(chosen, server.wordCount);
}

/* --- posicao de outro aparelho (US-174) ------------------------------------ */

/**
 * O que fazer com a posicao que o servidor tem quando a aba volta a ficar
 * visivel.
 *
 * - `"recarregar"`: o texto foi editado em outra aba (o numero de palavras
 *   mudou); a posicao daqui nao vale mais.
 * - um numero: outro aparelho gravou uma posicao diferente da ultima que
 *   esta aba conhece, e diferente de onde ela esta; pergunta se continua.
 * - null: nada mudou fora daqui.
 */
export function otherDevicePosition(
  remote: { progressIndex: number; wordCount: number },
  tab: { known: number; current: number; words: number }
): "recarregar" | number | null {
  if (remote.wordCount !== tab.words) return "recarregar";
  if (remote.progressIndex === tab.known || remote.progressIndex === tab.current) return null;
  return remote.progressIndex;
}

export function otherDeviceMessage(position: number): string {
  return `Você leu até a palavra ${position.toLocaleString("pt-BR")} em outro aparelho. Continuar de lá?`;
}

/** Resposta do servidor ao salvar a posicao de um texto que mudou (US-174). */
export const TEXT_CHANGED = "O texto foi editado em outra aba.";

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

/** Ate quantos dias atras a hora de leitura enviada pelo aparelho vale. */
export const MAX_READ_AT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Hora em que a sessao conta (US-172).
 *
 * Uma sessao lida offline na segunda e sincronizada na terca precisa contar
 * para a meta e a sequencia de segunda. O aparelho manda a hora da leitura;
 * vale ela, salvo se estiver no futuro em relacao ao servidor ou a mais de
 * 7 dias - ai o relogio do aparelho nao merece confianca e vale a do
 * servidor.
 */
export function sessionReadAt(readAt: unknown, serverNow: Date = new Date()): Date {
  if (typeof readAt !== "string") return serverNow;
  const at = Date.parse(readAt);
  if (Number.isNaN(at)) return serverNow;
  const now = serverNow.getTime();
  if (at > now || now - at > MAX_READ_AT_AGE_MS) return serverNow;
  return new Date(at);
}

/** Acoes que exigem rede e precisam avisar em vez de falhar em silencio. */
export const NEEDS_NETWORK = "Esta ação precisa de conexão.";
