/**
 * Cancela a inscricao de notificacao deste navegador (US-183).
 *
 * Chamado ao sair da conta: o servidor apaga a linha, e o
 * `pushManager.unsubscribe` faz o navegador deixar de aceitar mensagens da
 * inscricao antiga. Devolve o endpoint, para o servidor apagar tambem uma
 * inscricao anterior ao vinculo com o aparelho. Nunca lanca: sair da conta
 * nao pode depender disso.
 */
export async function dropPushSubscription(): Promise<string | null> {
  try {
    if (!("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return null;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => false);
    return endpoint;
  } catch {
    return null;
  }
}
