import "server-only";

import webpush from "web-push";

/**
 * Envio de notificacao push.
 *
 * As chaves VAPID sao geradas localmente e nao dependem de contratar nada: o
 * servidor so precisa provar a identidade para o servico de push do
 * navegador, e e isso que o par de chaves faz.
 */

let configured = false;

function setup(): boolean {
  if (configured) return true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:leitura@example.com";

  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function pushConfigured(): boolean {
  return setup();
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Manda uma notificacao.
 *
 * Devolve `"expirada"` quando o navegador diz que a inscricao nao vale mais
 * (404 ou 410): quem chamou deve apagar a linha, senao a mesma falha se
 * repete todo dia.
 */
export async function sendPush(
  target: PushTarget,
  payload: PushPayload
): Promise<"enviada" | "expirada" | "falhou"> {
  if (!setup()) return "falhou";

  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      { TTL: 6 * 60 * 60 }
    );
    return "enviada";
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "expirada";
    console.error("[push] falha ao enviar:", status ?? error);
    return "falhou";
  }
}
