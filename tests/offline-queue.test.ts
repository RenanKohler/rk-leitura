import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createSaveRetry,
  QUEUEABLE,
  queueDisposition,
  RETRY_STATUS,
  SAVE_FAILURES_BEFORE_NOTICE,
} from "@/lib/offline";

const sw = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");

describe("queueDisposition (US-171)", () => {
  it("mantem na fila 401, 408, 429 e 5xx", () => {
    for (const status of [401, 408, 429, 500, 502, 503, 504]) {
      expect(queueDisposition(status)).toBe("manter");
    }
  });

  it("descarta 400, 403, 404 e 409", () => {
    for (const status of [400, 403, 404, 409]) {
      expect(queueDisposition(status)).toBe("descartar");
    }
  });

  it("2xx foi gravada", () => {
    expect(queueDisposition(200)).toBe("enviada");
    expect(queueDisposition(202)).toBe("enviada");
  });

  it("o service worker usa a mesma regra", () => {
    const match = sw.match(/const RETRY_STATUS = \[([^\]]*)\]/);
    expect(match?.[1]?.split(",").map((n) => Number(n.trim()))).toEqual(RETRY_STATUS);
    expect(sw).toContain("status >= 500 || RETRY_STATUS.includes(status)");
  });

  it("o service worker enfileira as mesmas rotas", () => {
    const match = sw.match(/const QUEUEABLE = (\[.*\]);/);
    expect(match?.[1]).toBe(`[${QUEUEABLE.map(String).join(", ")}]`);
  });
});

describe("fila offline por conta (US-175)", () => {
  it("cada entrada guarda o dono e so as do dono atual saem", () => {
    expect(sw).toContain("store.add({ ...entry, owner })");
    expect(sw).toContain("if (entry.owner && entry.owner !== owner) continue;");
  });

  it("enfileirar pede Background Sync", () => {
    expect(sw).toContain('self.registration.sync?.register("leitura-fila")');
  });
});

function response(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("createSaveRetry (US-171)", () => {
  it("guarda o envio que falhou por rede e reenvia depois", async () => {
    const send = vi
      .fn<(body: string, keepalive: boolean) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response(201, { session: { id: "s1" } }));
    const retry = createSaveRetry(send, () => {});

    expect(await retry.post("a")).toBeNull();
    expect(retry.pendingCount()).toBe(1);
    await retry.retry();
    expect(retry.pendingCount()).toBe(0);
    expect(send).toHaveBeenLastCalledWith("a", false);
  });

  it("mantem 5xx e 401, descarta 400", async () => {
    const send = vi
      .fn<(body: string, keepalive: boolean) => Promise<Response>>()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(400));
    const retry = createSaveRetry(send, () => {});
    await retry.post("a");
    await retry.post("b");
    await retry.post("c");
    expect(retry.pendingCount()).toBe(2);
  });

  it("avisa depois de tres falhas seguidas e some na primeira que der certo", async () => {
    const changes: boolean[] = [];
    const send = vi.fn<(body: string, keepalive: boolean) => Promise<Response>>();
    for (let i = 0; i < SAVE_FAILURES_BEFORE_NOTICE; i++) send.mockResolvedValueOnce(response(500));
    send.mockResolvedValue(response(201));
    const retry = createSaveRetry(send, (failing) => changes.push(failing));

    await retry.post("a");
    await retry.post("b");
    expect(changes).toEqual([]);
    await retry.post("c");
    expect(changes).toEqual([true]);
    await retry.post("d");
    expect(changes).toEqual([true, false]);
  });

  it("falhas da posicao contam junto com as das sessoes", () => {
    const changes: boolean[] = [];
    const retry = createSaveRetry(vi.fn(), (failing) => changes.push(failing));
    retry.failed();
    retry.failed();
    retry.failed();
    retry.succeeded();
    expect(changes).toEqual([true, false]);
  });
});
