import {
  configuration,
  decryptTokens,
  digest,
  encryptTokens,
  errorResponse,
  json,
  PublicError,
  readJson,
  requestTokens,
  secretField,
  SESSION_TTL_MS,
  textField,
  type EncryptedTokens,
  type WorkbenchAuthEnv,
} from "./protocol.ts";

type Session = {
  id: string;
  challenge: string;
  nonce: string;
  expiresAt: number;
} & (
  | { status: "pending" }
  | { status: "processing" }
  | { status: "failed"; failureCode?: string }
  | { status: "complete"; encrypted: EncryptedTokens }
);

// This interface is deliberately limited to the runtime operations we use.
// Tests substitute storage at this boundary; production receives DurableObjectState.
export interface SessionState {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    deleteAll(): Promise<void>;
    setAlarm(time: number): Promise<void>;
    deleteAlarm(): Promise<void>;
  };
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

export class AuthSession {
  private readonly state: SessionState;
  private readonly env: WorkbenchAuthEnv;
  constructor(state: SessionState, env: WorkbenchAuthEnv) {
    this.state = state;
    this.env = env;
  }

  // Serializing the whole operation prevents concurrent callbacks or claims
  // from both consuming the same state. Token exchange has a ten-second timeout.
  async fetch(request: Request): Promise<Response> {
    try {
      return await this.state.blockConcurrencyWhile(async () => {
        // Expected request failures must not escape this callback: Cloudflare
        // resets a Durable Object when blockConcurrencyWhile rejects.
        try {
          return await this.handle(request);
        } catch (error) {
          return errorResponse(error);
        }
      });
    } catch (error) {
      return errorResponse(error);
    }
  }

  async alarm(): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      const session = await this.state.storage.get<Session>("session");
      if (!session || session.expiresAt <= Date.now()) {
        await this.state.storage.deleteAll();
      } else {
        await this.state.storage.setAlarm(session.expiresAt);
      }
    });
  }

  private async handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const body = await readJson(request);
    if (path === "/initialize") {
      if (await this.state.storage.get("session")) throw new PublicError("invalid_session", 409);
      const id = secretField({ body, name: "sessionId" });
      const challenge = secretField({ body, name: "claimChallenge" });
      const nonce = secretField({ body, name: "nonce" });
      const expiresAt = Date.now() + SESSION_TTL_MS;
      // Set the alarm first: an interrupted initialization must not leave
      // stored credentials/session metadata without a cleanup deadline.
      await this.state.storage.setAlarm(expiresAt);
      await this.state.storage.put<Session>("session", {
        id,
        challenge,
        nonce,
        expiresAt,
        status: "pending",
      });
      return json({ expiresAt: new Date(expiresAt).toISOString() });
    }

    const session = await this.state.storage.get<Session>("session");
    if (!session) throw new PublicError("invalid_session", 404);

    // Authenticate before disclosing whether the session expired or completed.
    if (path === "/claim") {
      const verifier = secretField({ body, name: "verifier" });
      if ((await digest(verifier)) !== session.challenge)
        throw new PublicError("invalid_session", 404);
    } else if (path === "/callback") {
      if (secretField({ body, name: "nonce" }) !== session.nonce)
        throw new PublicError("invalid_session", 404);
    } else {
      throw new PublicError("not_found", 404);
    }

    // An alarm is cleanup, not authorization: enforce expiry on every request.
    if (session.expiresAt <= Date.now()) {
      await this.clear();
      throw new PublicError("session_expired", 410);
    }

    if (path === "/claim") {
      if (session.status === "pending" || session.status === "processing")
        return json({ status: "pending" }, 202);
      if (session.status === "failed") {
        await this.clear();
        return json({ status: "failed", error: session.failureCode ?? "authorization_failed" });
      }
      const tokens = await decryptTokens({
        env: this.env,
        sessionId: session.id,
        encrypted: session.encrypted,
      });
      await this.clear();
      return json({ status: "complete", tokens });
    }

    if (session.status !== "pending") throw new PublicError("callback_already_used", 409);
    await this.state.storage.put<Session>("session", { ...session, status: "processing" });
    if (body.denied === true) {
      await this.state.storage.put<Session>("session", { ...session, status: "failed" });
      return json({ status: "failed" });
    }
    try {
      const code = textField({ body, name: "code", max: 4096 });
      const tokens = await requestTokens({
        env: this.env,
        grant: {
          grant_type: "authorization_code",
          code,
          redirect_uri: configuration(this.env).callbackUrl,
        },
      });
      const encrypted = await encryptTokens({ env: this.env, sessionId: session.id, tokens });
      if (session.expiresAt <= Date.now()) {
        await this.clear();
        throw new PublicError("session_expired", 410);
      }
      await this.state.storage.put<Session>("session", {
        ...session,
        status: "complete",
        encrypted,
      });
      return json({ status: "complete" });
    } catch (error) {
      if (session.expiresAt <= Date.now()) await this.clear();
      else
        await this.state.storage.put<Session>("session", {
          ...session,
          status: "failed",
          failureCode: error instanceof PublicError ? error.code : "internal_error",
        });
      throw error;
    }
  }

  private async clear(): Promise<void> {
    await this.state.storage.deleteAll();
    await this.state.storage.deleteAlarm();
  }
}
