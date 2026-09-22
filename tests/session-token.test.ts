import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";

beforeAll(() => {
  process.env.JWT_SECRET = "x".repeat(48);
});

describe("versao da sessao no token", () => {
  it("vai e volta no token", async () => {
    const { createToken, verifyToken } = await import("@/lib/session-token");
    const token = await createToken({ id: "u1", email: "a@b.com", name: "A", version: 3 });
    expect(await verifyToken(token)).toEqual({ id: "u1", email: "a@b.com", name: "A", version: 3 });
  });

  it("token emitido antes da versao existir vale como versao 0", async () => {
    const { verifyToken } = await import("@/lib/session-token");
    const { jwtSecret } = await import("@/lib/env");
    const legacy = await new SignJWT({ email: "a@b.com", name: "A" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setExpirationTime("1h")
      .sign(jwtSecret());
    expect((await verifyToken(legacy))?.version).toBe(0);
  });

  it("sessao so vale com a versao atual da conta", async () => {
    const { sessionIsCurrent } = await import("@/lib/auth");
    const session = { id: "u1", email: "a@b.com", name: "A", version: 1 };
    expect(sessionIsCurrent(session, 1)).toBe(true);
    expect(sessionIsCurrent(session, 2)).toBe(false);
    expect(sessionIsCurrent(session, null)).toBe(false);
  });
});
