// @effect-diagnostics nodeBuiltinImport:off - Native Vercel HTTP entrypoint is independent of the application runtime.
import type * as NodeHttp from "node:http";
import { handleLaunch } from "../lib/http.js";
import { launchPreview } from "../lib/lifecycle.js";

export default async function launch(
  request: NodeHttp.IncomingMessage,
  response: NodeHttp.ServerResponse,
) {
  return handleLaunch({
    request,
    response,
    environment: process.env,
    launch: ({ onProgress }) =>
      launchPreview({ environment: process.env, ...(onProgress ? { onProgress } : {}) }),
  });
}
