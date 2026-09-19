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

/** Paginas que o app precisa ter mesmo sem nunca ter sido visitado offline. */
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icon.svg"];

/** Rotas cujo envio pode esperar a conexao voltar. */
const QUEUEABLE = [/^\/api\/texts\/[0-9a-f-]+$/i, /^\/api\/reading-sessions$/];

/* --- fila local ---------------------------------------------------------- */

const DB_NAME = "leitura-offline";
const STORE = "fila";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
  });
}

const enqueue = (entry) => withStore("readwrite", (store) => store.add(entry));
const pending = () => withStore("readonly", (store) => store.getAll());
const forget = (id) => withStore("readwrite", (store) => store.delete(id));

/**
 * Manda o que ficou na fila, na ordem em que foi gerado.
 *
 * Um envio que falha por rede continua na fila; um que o servidor recusa sai
 * dela - repetir para sempre uma requisicao invalida so gastaria bateria.
 */
async function flushQueue() {
  const entries = await pending().catch(() => []);

  for (const entry of entries) {
    try {
      const response = await fetch(entry.url, {
        method: entry.method,
        headers: { "Content-Type": "application/json" },
        body: entry.body,
        credentials: "same-origin",
      });
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        await forget(entry.id);
      }
    } catch {
      // Sem rede ainda: para aqui e tenta de novo na proxima oportunidade.
      return;
    }
  }
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
          keys.filter((key) => key !== SHELL && key !== PAGES).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
      .then(flushQueue)
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "flush") event.waitUntil(flushQueue());
  // Sair da conta apaga tudo: o HTML guardado traz o texto da pessoa dentro.
  if (event.data?.type === "limpar") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
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

  try {
    const response = await fetch(request.clone());
    if (enfileiravel && response.ok) void flushQueue();
    return response;
  } catch (error) {
    if (!enfileiravel) throw error;

    const body = await request.clone().text();
    await enqueue({ url: request.url, method: request.method, body, at: Date.now() });

    return new Response(JSON.stringify({ queued: true }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === "leitura-fila") event.waitUntil(flushQueue());
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
      tag: "lembrete-diario",
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
