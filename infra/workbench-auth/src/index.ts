import {
  CALLBACK_PATH,
  configuration,
  errorResponse,
  JIRA_SCOPES,
  json,
  message,
  PublicError,
  randomSecret,
  readJson,
  secretField,
  requestTokens,
  textField,
  type WorkbenchAuthEnv,
} from "./protocol.ts";

export { AuthSession } from "./session.ts";
export type { WorkbenchAuthEnv } from "./protocol.ts";

const callSession = ({
  env,
  sessionId,
  path,
  body,
}: {
  env: WorkbenchAuthEnv;
  sessionId: string;
  path: string;
  body: Record<string, unknown>;
}) =>
  env.AUTH_SESSION.getByName(sessionId).fetch(
    new Request(`https://session${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

export const handleRequest = async (request: Request, env: WorkbenchAuthEnv): Promise<Response> => {
  try {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      try {
        configuration(env);
        return json({ status: "ready" });
      } catch {
        return json({ status: "not_configured" }, 503);
      }
    }
    const callback = request.method === "GET" && url.pathname === CALLBACK_PATH;
    const post =
      request.method === "POST" &&
      ["/jira/start", "/jira/claim", "/jira/refresh"].includes(url.pathname);
    if (!callback && !post) return message("Not found.", 404);
    const config = configuration(env);

    // Cloudflare supplies this header. Separate routes keep polling from
    // exhausting the login budget. This is an abuse limit, not authentication.
    const { success } = await env.AUTH_RATE_LIMITER.limit({
      key: `${url.pathname}:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`,
    });
    if (!success) {
      const response = json({ error: "rate_limited" }, 429);
      response.headers.set("Retry-After", "60");
      return response;
    }

    if (callback) {
      const state = url.searchParams.get("state") ?? "";
      const parts = state.split(".");
      if (parts.length !== 2) throw new PublicError("invalid_request", 400);
      const sessionId = secretField({ body: { sessionId: parts[0] }, name: "sessionId" });
      const nonce = secretField({ body: { nonce: parts[1] }, name: "nonce" });
      const denied = url.searchParams.has("error");
      const result = await callSession({
        env,
        sessionId,
        path: "/callback",
        body: {
          nonce,
          denied,
          code: url.searchParams.get("code"),
        },
      });
      if (!result.ok)
        return message(
          "Jira authorization could not be completed. Return to Workbench and reconnect.",
          result.status,
        );
      return message(
        denied
          ? "Jira connection was not completed. Return to Workbench."
          : "Jira authorization approved. Return to Workbench.",
      );
    }

    const body = await readJson(request);
    if (url.pathname === "/jira/start") {
      const claimChallenge = secretField({ body, name: "claimChallenge" });
      const sessionId = randomSecret();
      const nonce = randomSecret();
      const result = await callSession({
        env,
        sessionId,
        path: "/initialize",
        body: { sessionId, nonce, claimChallenge },
      });
      if (!result.ok) return result;
      const initialized = await readJson(result);
      const authorize = new URL("https://auth.atlassian.com/authorize");
      authorize.search = new URLSearchParams({
        audience: "api.atlassian.com",
        client_id: config.clientId,
        scope: JIRA_SCOPES,
        redirect_uri: config.callbackUrl,
        response_type: "code",
        prompt: "consent",
        state: `${sessionId}.${nonce}`,
      }).toString();
      return json({
        sessionId,
        authorizationUrl: authorize.toString(),
        expiresAt: textField({ body: initialized, name: "expiresAt" }),
      });
    }
    if (url.pathname === "/jira/claim") {
      const sessionId = secretField({ body, name: "sessionId" });
      const verifier = secretField({ body, name: "verifier" });
      return await callSession({ env, sessionId, path: "/claim", body: { verifier } });
    }

    const refreshToken = textField({ body, name: "refreshToken" });
    const tokens = await requestTokens({
      env,
      grant: { grant_type: "refresh_token", refresh_token: refreshToken },
    });
    return json({ tokens });
  } catch (error) {
    return errorResponse(error);
  }
};

export default { fetch: handleRequest };
