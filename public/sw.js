/*
 * Service worker do Leitura.
 *
 * Tres responsabilidades, nesta ordem de importancia:
 *
 * 1. Deixar ler offline o que ja foi aberto com conexao.
 * 2. Guardar o que foi lido offline e mandar ao servidor quando ela voltar.
 * 3. Receber o lembrete diario (US-43).
 *
 * O que ele nao faz, de proposito: servir resposta de API a partir do cache.
 * As respostas carregam dados da conta e dependem do cookie de sessao; uma
 * copia guardada aqui sobreviveria a saida da conta. O que fica em cache e a
 * navegacao - o HTML do leitor, que ja traz o texto dentro.
 */

// A versao entra no nome do cache: publicar uma versao nova descarta a
// anterior inteira, que e o criterio 5 da US-40.
const VERSION = "v1";
const SHELL = `leitura-casca-${VERSION}`;
const PAGES = `leitura-paginas-${VERSION}`;
const OFFLINE_URL = "/offline";

// Vozes baixadas (Piper): gravadas pela tela, nunca por aqui. Nao tem versao
// no nome e nao sai na limpeza - sao ~90 MB que nao dizem nada da conta, e
// apagar a cada deploy ou saida obrigaria a baixar tudo de novo.
const VOICES = "leitura-vozes";

/** Paginas que o app precisa ter mesmo sem nunca ter sido visitado offline. */
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icon.svg"];

/** Rotas cujo envio pode esperar a conexao voltar. */
const QUEUEABLE = [/^\/api\/texts\/[0-9a-f-]+$/i, /^\/api\/reading-sessions$/];

/**
 * Respostas que mantem a entrada na fila (US-171): sessao expirada, tempo
 * esgotado, limite de taxa e 5xx. Os demais 4xx descartam. Mesma regra de
 * `queueDisposition` em `src/lib/offline.ts`.
 */
const RETRY_STATUS = [401, 408, 429];

function keepInQueue(status) {
  return status >= 500 || RETRY_STATUS.includes(status);
}

/* --- fila local ---------------------------------------------------------- */

const DB_NAME = "leitura-offline";
const STORE = "fila";
// Conta que esta usando o app agora, informada pela pagina (US-175).
const META = "meta";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
      if (!request.result.objectStoreNames.contains(META)) {
        request.result.createObjectStore(META);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, run, name = STORE) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const result = run(tx.objectStore(name));
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
  });
}

const pending = () => withStore("readonly", (store) => store.getAll());
const forget = (id) => withStore("readwrite", (store) => store.delete(id));
const currentOwner = () =>
  withStore("readonly", (store) => store.get("dono"), META).then((owner) => owner ?? null);
const setOwner = (owner) =>
  withStore("readwrite", (store) => store.put(owner ?? null, "dono"), META);

/**
 * Entra na fila com o dono atual (US-175) e pede um Background Sync: com
 * ele, o navegador envia a fila quando a rede volta mesmo com o app fechado.
 * Sem suporte, a fila sai quando o app abrir com rede, como antes.
 */
async function enqueue(entry) {
  const owner = await currentOwner().catch(() => null);
  await withStore("readwrite", (store) => store.add({ ...entry, owner }));
  await self.registration.sync?.register("leitura-fila").catch(() => undefined);
}

/**
 * Manda o que ficou na fila, na ordem em que foi gerado.
 *
 * So as entradas do dono atual saem (US-175): a fila de outra conta espera o
 * dono dela entrar de novo neste aparelho. Entradas antigas, sem dono, saem
 * como antes. Falha de rede, 401, 408, 429 e 5xx mantem a entrada (US-171);
 * os demais 4xx a descartam - repetir uma requisicao invalida so gastaria
 * bateria. Devolve falso quando parou antes do fim, para o Background Sync
 * tentar de novo.
 */
async function flushQueue() {
  const owner = await currentOwner().catch(() => null);
  const entries = await pending().catch(() => []);

  for (const entry of entries) {
    if (entry.owner && entry.owner !== owner) continue;
    if (!owner && entry.owner !== undefined) continue;
    try {
      const response = await fetch(entry.url, {
        method: entry.method,
        headers: { "Content-Type": "application/json" },
        body: entry.body,
        credentials: "same-origin",
      });
      if (!keepInQueue(response.status)) {
        await forget(entry.id);
        continue;
      }
      // Sessao expirada ou servidor com problema: o resto teria a mesma
      // resposta. Fica tudo para a proxima oportunidade.
      return false;
    } catch {
      // Sem rede ainda: para aqui e tenta de novo na proxima oportunidade.
      return false;
    }
  }
  return true;
}

/* --- ciclo de vida ------------------------------------------------------- */

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL && key !== PAGES && key !== VOICES)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
      .then(flushQueue)
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "flush") event.waitUntil(flushQueue());
  // A pagina informa a conta da sessao a cada carregamento (US-175). Com o
  // dono de volta, a fila dele sai.
  if (event.data?.type === "conta") {
    event.waitUntil(
      setOwner(event.data.userId ?? null)
        .then(() => (event.data.userId ? flushQueue() : undefined))
        .catch(() => undefined)
    );
  }
  // Sair da conta apaga tudo o que e da conta: o HTML guardado traz o texto
  // da pessoa dentro. As vozes baixadas ficam.
  if (event.data?.type === "limpar") {
    // A fila nao e apagada: cada entrada tem o dono gravado e so sai quando
    // ele entrar de novo (US-175). Sem dono atual, nada sai.
    event.waitUntil(
      setOwner(null).catch(() => undefined).then(() => caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((k) => k !== VOICES).map((k) => caches.delete(k)))
        ))
    );
  }
});

/* --- requisicoes --------------------------------------------------------- */

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    event.respondWith(handleWrite(request));
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Resposta de API nunca sai do cache: ela depende de quem esta na sessao.
  if (url.pathname.startsWith("/api/")) return;

  // Tambem guarda o que a tela pede de proposito para ler offline depois:
  // um `fetch` de aquecimento nao e navegacao, e sem isto so ficaria em
  // cache a pagina que o leitor ja tinha aberto.
  if (request.mode === "navigate" || READABLE.test(url.pathname)) {
    event.respondWith(handleNavigation(request));
  }
});

/** Paginas que fazem sentido abrir sem conexao. */
const READABLE = /^\/(leitor\/|textos$)/;

/**
 * Quantas paginas de leitura ficam guardadas.
 *
 * O HTML do leitor traz o texto inteiro dentro, entao cada entrada pesa o
 * tamanho do proprio texto. Vinte cobre a biblioteca recente sem tomar o
 * armazenamento do navegador.
 */
const MAX_PAGES = 22;

/** Descarta as entradas mais antigas quando o cache passa do teto. */
async function trimPages() {
  const cache = await caches.open(PAGES);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) {
    await cache.delete(key);
  }
}

/**
 * Navegacao: rede primeiro, cache como rede de seguranca.
 *
 * Rede primeiro e o que impede alguem de ficar preso a uma versao antiga -
 * com cache primeiro, publicar uma correcao nao chegaria a quem ja tem a
 * pagina guardada.
 */
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      const url = new URL(request.url);
      // So o que se le offline entra: o leitor e a biblioteca.
      if (READABLE.test(url.pathname)) {
        caches
          .open(PAGES)
          .then((cache) => cache.put(request, copy))
          .then(trimPages);
      }
    }
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;

    const offline = await caches.match(OFFLINE_URL);
    return offline ?? new Response("Sem conexao", { status: 503 });
  }
}

/**
 * Escrita sem rede: entra na fila e responde como se tivesse dado certo.
 *
 * So para o que pode esperar. Importar exige buscar uma pagina externa, e
 * fingir sucesso ali deixaria o leitor achando que o texto esta salvo.
 */
async function handleWrite(request) {
  const url = new URL(request.url);
  const enfileiravel =
    (request.method === "PATCH" || request.method === "POST") &&
    QUEUEABLE.some((pattern) => pattern.test(url.pathname));

  // O corpo e lido antes do envio: depois dele o pedido ja foi consumido.
  const body = enfileiravel ? await request.clone().text() : null;
  const queued = async () => {
    await enqueue({ url: request.url, method: request.method, body, at: Date.now() });
    return new Response(JSON.stringify({ queued: true }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const response = await fetch(request.clone());
    if (!enfileiravel) return response;
    if (response.ok) {
      void flushQueue();
      return response;
    }
    // Sessao expirada ou falha passageira: a gravacao espera na fila em vez
    // de se perder (US-171).
    if (keepInQueue(response.status)) return await queued();
    return response;
  } catch (error) {
    if (!enfileiravel) throw error;
    return await queued();
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag !== "leitura-fila") return;
  // Rejeitar faz o navegador agendar outra tentativa.
  event.waitUntil(
    flushQueue().then((done) => {
      if (!done) throw new Error("fila pendente");
    })
  );
});

/* --- lembrete ------------------------------------------------------------ */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {};
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Leitura", {
      body: payload.body ?? "Voce ainda nao leu hoje.",
      icon: "/icon.svg",
      badge: "/icon.svg",
      // Cada tipo de aviso tem a propria tag (US-201); payload antigo sem tag
      // mantem a de antes.
      tag: payload.tag ?? "lembrete-diario",
      data: { url: payload.url ?? "/dashboard" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = event.notification.data?.url ?? "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reaproveita uma janela aberta em vez de abrir outra por toque.
      const open = clients.find((client) => client.url.includes(self.location.origin));
      if (open) {
        open.focus();
        return open.navigate(destino);
      }
      return self.clients.openWindow(destino);
    })
  );
});
