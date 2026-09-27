// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - Native Vercel HTTP boundary and local contract test are independent of the application runtime.
import type * as NodeHttp from "node:http";

export const handleLaunch = async ({
  request,
  response,
  environment,
  launch,
}: {
  request: NodeHttp.IncomingMessage;
  response: NodeHttp.ServerResponse;
  environment: NodeJS.ProcessEnv;
  launch: () => Promise<{ pairingUrl: string } | { unavailable: "revision-changed" }>;
}) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json");
  const reply = (status: number, message: string) => {
    response.statusCode = status;
    response.end(JSON.stringify({ error: message }));
  };
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return reply(405, "Use POST to open a demo.");
  }
  if (environment.VERCEL_ENV !== "preview" || !environment.VERCEL_URL)
    return reply(503, "This launcher requires a protected preview deployment.");
  if (request.headers.origin !== `https://${environment.VERCEL_URL}`)
    return reply(403, "Open the demo from this preview page.");
  if (request.url !== "/api/launch") return reply(400, "Launch parameters are not accepted.");
  for await (const chunk of request) {
    if (chunk.length > 0) return reply(400, "Launch parameters are not accepted.");
  }
  try {
    const result = await launch();
    if ("unavailable" in result)
      return reply(
        409,
        "This preview is out of date or its PR has closed. Open the latest demo link from the PR.",
      );
    response.statusCode = 200;
    response.end(JSON.stringify(result));
  } catch {
    // Provider errors may contain command output or private credentials. Never echo them.
    reply(502, "The demo could not start. Try again.");
  }
};
