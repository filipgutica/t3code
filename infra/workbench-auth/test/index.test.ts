import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { handleRequest, type WorkbenchAuthEnv } from "../src/index.ts";

const challenge = "AQ".repeat(22).slice(0, 43);
const sessionId = "Ag".repeat(22).slice(0, 43);
const verifier = "Aw".repeat(22).slice(0, 43);

const makeEnvironment = (sessionStub: {
  fetch(request: Request): Promise<Response>;
}): WorkbenchAuthEnv => ({
  PUBLIC_BASE_URL: "https://workbench-auth.example.workers.dev",
  ATLASSIAN_CLIENT_ID: "client-id",
  ATLASSIAN_CLIENT_SECRET: "client-secret",
  SESSION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  AUTH_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
  AUTH_SESSION: {
    getByName: vi.fn(() => sessionStub),
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Workbench Jira auth Worker", () => {
  it("returns a safe response when claim transport fails", async () => {
    const env = makeEnvironment({
      fetch: async () => {
        throw new Error("private transport details");
      },
    });
    const response = await handleRequest(
      new Request("https://worker/jira/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, verifier }),
      }),
      env,
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "internal_error" });
  });

  it("rejects an oversized streamed body before creating a session", async () => {
    const sessionStub = { fetch: vi.fn(async () => Response.json({})) };
    const response = await handleRequest(
      new Request("https://worker/jira/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimChallenge: "x".repeat(20_000) }),
      }),
      makeEnvironment(sessionStub),
    );
    expect(response.status).toBe(413);
    expect(sessionStub.fetch).not.toHaveBeenCalled();
  });

  it("creates a short lived Jira authorization session without exposing the claim secret", async () => {
    const sessionStub = {
      fetch: vi.fn(async () => Response.json({ expiresAt: "2026-09-11T12:00:00.000Z" })),
    };
    const env = makeEnvironment(sessionStub);

    const response = await handleRequest(
      new Request("https://workbench-auth.example.workers.dev/jira/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claimChallenge: challenge }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      sessionId: string;
      authorizationUrl: string;
      expiresAt: string;
    };
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{32,64}$/);
    expect(body.authorizationUrl).toContain("https://auth.atlassian.com/authorize?");
    expect(body.authorizationUrl).toContain("client_id=client-id");
    expect(body.authorizationUrl).not.toContain(challenge);
    expect(body.expiresAt).toMatch(/^20\d\d-/);
    expect(sessionStub.fetch).toHaveBeenCalledOnce();
  });

  it("rejects a non-JSON start request before creating a session", async () => {
    const sessionStub = { fetch: vi.fn(async () => Response.json({ ok: true })) };
    const env = makeEnvironment(sessionStub);

    const response = await handleRequest(
      new Request("https://workbench-auth.example.workers.dev/jira/start", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ claimChallenge: challenge }),
      }),
      env,
    );

    expect(response.status).toBe(415);
    expect(sessionStub.fetch).not.toHaveBeenCalled();
  });

  it("does not expose callback query parameters in its response", async () => {
    const sessionStub = {
      fetch: vi.fn(async () => Response.json({ error: "invalid_callback" }, { status: 400 })),
    };
    const env = makeEnvironment(sessionStub);

    const response = await handleRequest(
      new Request(
        `https://workbench-auth.example.workers.dev/oauth/jira/callback?error=access_denied&state=${sessionId}&code=private-code`,
      ),
      env,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const body = await response.text();
    expect(body).not.toContain("private-code");
    expect(body).not.toContain(sessionId);
  });

  it("keeps an invalid claim opaque and does not return session state", async () => {
    const sessionStub = {
      fetch: vi.fn(async () => Response.json({ error: "invalid_claim" }, { status: 401 })),
    };
    const env = makeEnvironment(sessionStub);

    const response = await handleRequest(
      new Request("https://workbench-auth.example.workers.dev/jira/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, verifier }),
      }),
      env,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_claim" });
  });

  it("normalizes a Jira refresh response and preserves a rotating refresh token", async () => {
    const sessionStub = { fetch: vi.fn(async () => Response.json({ ok: true })) };
    const env = makeEnvironment(sessionStub);
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      Response.json({
        access_token: "new-access-token",
        expires_in: 3600,
        refresh_token: "new-refresh-token",
        scope: "read:jira-work offline_access",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRequest(
      new Request("https://workbench-auth.example.workers.dev/jira/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "old-refresh-token" }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      tokens: {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        scope: "read:jira-work offline_access",
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://auth.atlassian.com/oauth/token");
  });

  it("fails closed when the Atlassian app is not configured", async () => {
    const env = {
      PUBLIC_BASE_URL: "https://workbench-auth.example.workers.dev",
      ATLASSIAN_CLIENT_ID: "",
      ATLASSIAN_CLIENT_SECRET: "",
      SESSION_ENCRYPTION_KEY: "",
      AUTH_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    } as unknown as WorkbenchAuthEnv;

    const response = await handleRequest(
      new Request("https://workbench-auth.example.workers.dev/jira/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claimChallenge: challenge }),
      }),
      env,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
  });

  it("rejects an abuse-limited request before contacting the session", async () => {
    const sessionStub = { fetch: vi.fn(async () => Response.json({ ok: true })) };
    const env = makeEnvironment(sessionStub);
    env.AUTH_RATE_LIMITER.limit = vi.fn(async () => ({ success: false }));

    const response = await handleRequest(
      new Request("https://workbench-auth.example.workers.dev/jira/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claimChallenge: challenge }),
      }),
      env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(sessionStub.fetch).not.toHaveBeenCalled();
  });
});
