import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { AuthSession, type SessionState } from "../src/session.ts";
import { digest, type WorkbenchAuthEnv } from "../src/protocol.ts";

const sessionId = "Ag".repeat(22).slice(0, 43);
const nonce = "AB".repeat(22).slice(0, 43);
const verifier = "Aw".repeat(22).slice(0, 43);
const wrongVerifier = "AQ".repeat(22).slice(0, 43);

const makeState = () => {
  let stored: unknown;
  let queue = Promise.resolve();
  const storage: SessionState["storage"] = {
    get: async <T>() => stored as T | undefined,
    put: async <T>(_key: string, value: T) => {
      stored = value;
    },
    deleteAll: vi.fn(async () => {
      stored = undefined;
    }),
    setAlarm: vi.fn(async () => undefined),
    deleteAlarm: vi.fn(async () => undefined),
  };
  const state: SessionState = {
    storage,
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => {
      const result = queue.then(callback, callback);
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  return { state, storage };
};

const makeEnvironment = () =>
  ({
    PUBLIC_BASE_URL: "https://workbench-auth.example.workers.dev",
    ATLASSIAN_CLIENT_ID: "client-id",
    ATLASSIAN_CLIENT_SECRET: "client-secret",
    SESSION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    AUTH_SESSION: { getByName: vi.fn() },
    AUTH_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
  }) as WorkbenchAuthEnv;

const jsonRequest = (path: string, body: Record<string, unknown>) =>
  new Request(`https://session${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const initialize = async (auth: AuthSession) =>
  auth.fetch(
    jsonRequest("/initialize", {
      sessionId,
      nonce,
      claimChallenge: await digest(verifier),
    }),
  );

const complete = (auth: AuthSession) =>
  auth.fetch(jsonRequest("/callback", { nonce, code: "oauth-code" }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuthSession", () => {
  it("persists an encrypted result, authenticates claims, and consumes it once", async () => {
    const { state, storage } = makeState();
    const env = makeEnvironment();
    const auth = new AuthSession(state, env);
    const fetchMock = vi.fn(async () =>
      Response.json({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "read:jira-work offline_access",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect((await initialize(auth)).status).toBe(200);
    expect((await complete(auth)).status).toBe(200);
    const storedResult = await storage.get<Record<string, unknown>>("session");
    expect(JSON.stringify(storedResult)).not.toContain("access-token");

    const wrong = await auth.fetch(jsonRequest("/claim", { verifier: wrongVerifier }));
    expect(wrong.status).toBe(404);
    expect(storage.deleteAll).not.toHaveBeenCalled();

    const claims = await Promise.all([
      auth.fetch(jsonRequest("/claim", { verifier })),
      auth.fetch(jsonRequest("/claim", { verifier })),
    ]);
    expect(claims.map((response) => response.status).sort()).toEqual([200, 404]);
    const successful = claims.find((response) => response.status === 200);
    expect(await successful?.json()).toMatchObject({
      status: "complete",
      tokens: { accessToken: "access-token", refreshToken: "refresh-token" },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reserves a callback once before exchanging its code", async () => {
    const { state } = makeState();
    const env = makeEnvironment();
    const auth = new AuthSession(state, env);
    const fetchMock = vi.fn(async () =>
      Response.json({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "read:jira-work offline_access",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await initialize(auth);

    const callbacks = await Promise.all([complete(auth), complete(auth)]);
    expect(callbacks.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("records an upstream authorization failure without exposing its response", async () => {
    const { state } = makeState();
    const env = makeEnvironment();
    const auth = new AuthSession(state, env);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "private-provider-detail" }, { status: 500 })),
    );
    await initialize(auth);

    const callback = await complete(auth);
    expect(callback.status).toBe(502);
    expect(await callback.json()).toEqual({ error: "authorization_failed" });

    const claim = await auth.fetch(jsonRequest("/claim", { verifier }));
    expect(claim.status).toBe(200);
    expect(await claim.json()).toEqual({ status: "failed", error: "authorization_failed" });
  });

  it("only reveals the safe provider failure code to the verified claimant", async () => {
    const { state } = makeState();
    const auth = new AuthSession(state, makeEnvironment());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "invalid_client",
            error_description: "private-provider-detail",
          },
          { status: 401 },
        ),
      ),
    );
    await initialize(auth);
    expect((await complete(auth)).status).toBe(502);
    const wrong = await auth.fetch(jsonRequest("/claim", { verifier: wrongVerifier }));
    expect(wrong.status).toBe(404);
    const claim = await auth.fetch(jsonRequest("/claim", { verifier }));
    expect(await claim.json()).toEqual({ status: "failed", error: "atlassian_invalid_client" });
  });

  it("enforces expiry synchronously and cleans expired sessions from the alarm", async () => {
    const { state, storage } = makeState();
    const env = makeEnvironment();
    const auth = new AuthSession(state, env);
    await initialize(auth);
    const stored = await storage.get<Record<string, unknown>>("session");
    await storage.put("session", { ...stored, expiresAt: 0 });

    const response = await auth.fetch(jsonRequest("/claim", { verifier }));
    expect(response.status).toBe(410);
    expect(storage.deleteAll).toHaveBeenCalledOnce();

    await initialize(auth);
    const second = await storage.get<Record<string, unknown>>("session");
    await storage.put("session", { ...second, expiresAt: 0 });
    await auth.alarm();
    expect(storage.deleteAll).toHaveBeenCalledTimes(2);
  });
});
