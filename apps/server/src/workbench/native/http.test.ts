import { expect, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import * as NodeServices from "@effect/platform-node/NodeServices";

import * as Effect from "effect/Effect";

import * as Layer from "effect/Layer";

import { HttpRouter } from "effect/http";

import * as ServerConfig from "../../config.ts";

import * as ServerHttp from "../../http.ts";

describe("browser API CORS", () => {
  it.each([
    "t3code://app",
    "t3code-dev://app",
    "t3code-workbench://app",
    "t3code-workbench-dev://app",
  ])("allows credentialed development preflights from %s", async (origin) => {
    const configLayer = Layer.effect(
      ServerConfig.ServerConfig,
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        return { ...config, devUrl: new URL("http://localhost:5173") };
      }),
    ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "http-desktop-cors-" })));
    const appLayer = ServerHttp.layerBrowserApiCors.pipe(
      Layer.provide(configLayer),
      Layer.provide(NodeServices.layer),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(appLayer, { disableLogger: true });
    try {
      const response = await handler(
        new Request("http://localhost:3000/api/auth/session", {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": "GET",
            "access-control-request-headers": "content-type",
          },
        }),
      );
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    } finally {
      await dispose();
    }
  });
});
