import { beforeEach, describe, expect, it, vi } from "vitest";

// Limitador em memoria no lugar do Postgres: conta por chave, como o real.
const counts = new Map<string, number>();
vi.mock("@/lib/rate-limit", () => ({
  clientIp: (request: Request) => request.headers.get("x-forwarded-for") ?? "0.0.0.0",
  rateLimit: vi.fn(async (key: string, limit: number) => {
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return { allowed: count <= limit, retryAfterSeconds: count <= limit ? 0 : 60 };
  }),
}));

const authenticate = vi.fn();
vi.mock("@/lib/auth", () => ({
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
  authenticateUser: (...args: unknown[]) => authenticate(...args),
  openSession: vi.fn(async () => undefined),
}));

const { POST } = await import("@/app/api/auth/login/route");
const LOGIN_ATTEMPTS_PER_ACCOUNT = 10;

function attempt(email: string, password: string, ip: string) {
  return POST(
    new Request("http://local/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ email, password }),
    })
  );
}

describe("limite de login por conta (US-185)", () => {
  beforeEach(() => {
    counts.clear();
    authenticate.mockReset();
  });

  it("bloqueia a 11a tentativa da mesma conta vinda de IPs diferentes", async () => {
    authenticate.mockResolvedValue(null);
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_ACCOUNT; i++) {
      const response = await attempt("ana@x.test", "errada", `10.0.0.${i}`);
      expect(response.status).toBe(401);
    }
    const blocked = await attempt("ana@x.test", "errada", "10.0.1.1");
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toBe("Muitas tentativas. Tente de novo em alguns minutos.");
  });

  it("recusa ate a senha certa durante o bloqueio, sem conferi-la", async () => {
    authenticate.mockResolvedValue(null);
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_ACCOUNT; i++) {
      await attempt("ana@x.test", "errada", `10.0.0.${i}`);
    }
    authenticate.mockClear();
    authenticate.mockResolvedValue({ id: "u", email: "ana@x.test", name: "Ana", sessionVersion: 0 });
    const response = await attempt("ana@x.test", "certa", "10.0.2.1");
    expect(response.status).toBe(429);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("usa o e-mail normalizado na chave", async () => {
    authenticate.mockResolvedValue(null);
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_ACCOUNT; i++) {
      await attempt(i % 2 ? " ANA@x.test " : "ana@X.TEST", "errada", `10.0.0.${i}`);
    }
    expect((await attempt("Ana@x.test", "errada", "10.9.9.9")).status).toBe(429);
  });

  it("outra conta nao e afetada", async () => {
    authenticate.mockResolvedValue(null);
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_ACCOUNT + 1; i++) {
      await attempt("ana@x.test", "errada", `10.0.0.${i}`);
    }
    expect((await attempt("bia@x.test", "errada", "10.0.3.1")).status).toBe(401);
  });
});
