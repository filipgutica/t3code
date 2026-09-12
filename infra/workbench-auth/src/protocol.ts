export const SESSION_TTL_MS = 5 * 60_000;
export const CALLBACK_PATH = "/oauth/jira/callback";
export const JIRA_SCOPES = [
  "read:project:jira",
  "read:jira-work",
  "write:jira-work",
  "read:board-scope:jira-software",
  "read:board-scope.admin:jira-software",
  "read:sprint:jira-software",
  "read:issue-details:jira",
  "read:jql:jira",
  "offline_access",
].join(" ");

export interface WorkbenchAuthEnv {
  PUBLIC_BASE_URL?: string;
  ATLASSIAN_CLIENT_ID?: string;
  ATLASSIAN_CLIENT_SECRET?: string;
  SESSION_ENCRYPTION_KEY?: string;
  AUTH_SESSION: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
  AUTH_RATE_LIMITER: { limit(input: { key: string }): Promise<{ success: boolean }> };
}

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string;
};

export class PublicError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
export const message = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  });
export const errorResponse = (error: unknown) =>
  error instanceof PublicError
    ? json({ error: error.code }, error.status)
    : json({ error: "internal_error" }, 500);

export const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PublicError("invalid_request", 400);
  }
  return Object.fromEntries(Object.entries(value));
};

// Bound streamed bodies too: Content-Length is optional and cannot be trusted.
export const readJson = async (request: Request | Response): Promise<Record<string, unknown>> => {
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
    throw new PublicError("unsupported_media_type", 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new PublicError("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) {
      await reader.cancel();
      throw new PublicError("request_too_large", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return record(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new PublicError("invalid_request", 400);
  }
};

export const textField = ({
  body,
  name,
  max = 8192,
}: {
  body: Record<string, unknown>;
  name: string;
  max?: number;
}): string => {
  const value = body[name];
  if (typeof value !== "string" || !value.length || value.length > max) {
    throw new PublicError("invalid_request", 400);
  }
  return value;
};

export const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
export const randomSecret = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async (value: string) =>
  base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
export const secretField = ({ body, name }: { body: Record<string, unknown>; name: string }) => {
  const value = textField({ body, name, max: 43 });
  // SHA-256 hashes and random 32-byte values, canonically encoded without padding.
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value)) {
    throw new PublicError("invalid_request", 400);
  }
  return value;
};

const keyBytes = (value: string) => {
  try {
    const decoded = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
      c.charCodeAt(0),
    );
    if (decoded.length !== 32) throw new Error("length");
    return decoded;
  } catch {
    throw new PublicError("service_unavailable", 503);
  }
};

export const configuration = (env: WorkbenchAuthEnv) => {
  if (
    !env.PUBLIC_BASE_URL ||
    !env.ATLASSIAN_CLIENT_ID?.trim() ||
    !env.ATLASSIAN_CLIENT_SECRET?.trim() ||
    !env.SESSION_ENCRYPTION_KEY ||
    !env.AUTH_SESSION ||
    !env.AUTH_RATE_LIMITER
  ) {
    throw new PublicError("service_unavailable", 503);
  }
  let origin: URL;
  try {
    origin = new URL(env.PUBLIC_BASE_URL);
  } catch {
    throw new PublicError("service_unavailable", 503);
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new PublicError("service_unavailable", 503);
  }
  return {
    callbackUrl: origin.origin + CALLBACK_PATH,
    clientId: env.ATLASSIAN_CLIENT_ID.trim(),
    clientSecret: env.ATLASSIAN_CLIENT_SECRET,
    encryptionKey: keyBytes(env.SESSION_ENCRYPTION_KEY),
  };
};

export const requestTokens = async ({
  env,
  grant,
}: {
  env: WorkbenchAuthEnv;
  grant:
    | { grant_type: "authorization_code"; code: string; redirect_uri: string }
    | { grant_type: "refresh_token"; refresh_token: string };
}): Promise<Tokens> => {
  const config = configuration(env);
  let response: Response;
  try {
    response = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      // Workers supports manual redirects; never forward client credentials to another URL.
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...grant,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new PublicError("upstream_unavailable", 502);
  }
  let body: Record<string, unknown>;
  try {
    body = await readJson(response);
  } catch {
    throw new PublicError(response.ok ? "invalid_token_response" : "authorization_failed", 502);
  }
  if (!response.ok) {
    // Return only known OAuth error identifiers, never provider descriptions.
    switch (body.error) {
      case "invalid_client":
        throw new PublicError("atlassian_invalid_client", 502);
      case "invalid_grant":
        throw new PublicError("atlassian_invalid_grant", 502);
      case "invalid_scope":
        throw new PublicError("atlassian_invalid_scope", 502);
      case "unauthorized_client":
        throw new PublicError("atlassian_unauthorized_client", 502);
      default:
        throw new PublicError("authorization_failed", 502);
    }
  }
  if (typeof body.access_token !== "string" || !body.access_token)
    throw new PublicError("missing_access_token", 502);
  if (typeof body.refresh_token !== "string" || !body.refresh_token)
    throw new PublicError("missing_refresh_token", 502);
  if (typeof body.scope !== "string" || !body.scope)
    throw new PublicError("missing_token_scope", 502);
  try {
    const accessToken = textField({ body, name: "access_token" });
    const refreshToken = textField({ body, name: "refresh_token" });
    const scope = textField({ body, name: "scope", max: 4096 });
    if (
      typeof body.expires_in !== "number" ||
      !Number.isSafeInteger(body.expires_in) ||
      body.expires_in <= 0 ||
      body.expires_in > 31_536_000
    ) {
      throw new Error("invalid expiry");
    }
    return {
      accessToken,
      refreshToken,
      scope,
      expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
    };
  } catch {
    throw new PublicError("invalid_token_response", 502);
  }
};

export type EncryptedTokens = { iv: string; ciphertext: string };
const decode = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export const encryptTokens = async ({
  env,
  sessionId,
  tokens,
}: {
  env: WorkbenchAuthEnv;
  sessionId: string;
  tokens: Tokens;
}): Promise<EncryptedTokens> => {
  const key = await crypto.subtle.importKey(
    "raw",
    configuration(env).encryptionKey,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(sessionId) },
    key,
    new TextEncoder().encode(JSON.stringify(tokens)),
  );
  return {
    iv: btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
  };
};
export const decryptTokens = async ({
  env,
  sessionId,
  encrypted,
}: {
  env: WorkbenchAuthEnv;
  sessionId: string;
  encrypted: EncryptedTokens;
}): Promise<Tokens> => {
  const key = await crypto.subtle.importKey(
    "raw",
    configuration(env).encryptionKey,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decode(encrypted.iv),
      additionalData: new TextEncoder().encode(sessionId),
    },
    key,
    decode(encrypted.ciphertext),
  );
  const body = record(JSON.parse(new TextDecoder().decode(plaintext)));
  return {
    accessToken: textField({ body, name: "accessToken" }),
    refreshToken: textField({ body, name: "refreshToken" }),
    scope: textField({ body, name: "scope" }),
    expiresAt: textField({ body, name: "expiresAt" }),
  };
};
