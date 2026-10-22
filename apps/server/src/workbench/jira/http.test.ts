import { assert, describe, it } from "@effect/vitest";
import {
  WorkbenchJiraOperationError,
  type WorkbenchJiraCompleteAuthInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";

import * as WorkbenchJiraService from "@t3tools/workbench/jira/WorkbenchJiraService";
import { workbenchJiraOAuthRouteLayer } from "./http.ts";

const serveRoute = (
  completeAuth: WorkbenchJiraService.WorkbenchJiraService["Service"]["completeAuth"],
) =>
  HttpRouter.toHttpEffect(
    workbenchJiraOAuthRouteLayer.pipe(
      Layer.provide(Layer.mock(WorkbenchJiraService.WorkbenchJiraService)({ completeAuth })),
    ),
  );

const expectNoStoreHeaders = (response: { readonly headers: Record<string, string> }) => {
  assert.strictEqual(response.headers["cache-control"], "no-store");
  assert.strictEqual(response.headers["pragma"], "no-cache");
  assert.strictEqual(response.headers["referrer-policy"], "no-referrer");
};

const responseText = (response: HttpServerResponse.HttpServerResponse) => {
  assert.strictEqual(response.body._tag, "Uint8Array");
  if (response.body._tag !== "Uint8Array") return "";
  return new TextDecoder().decode(response.body.body);
};

const getCallbackResponse = (
  completeAuth: WorkbenchJiraService.WorkbenchJiraService["Service"]["completeAuth"],
  url: string,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handler = yield* serveRoute(completeAuth);
      return yield* handler.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(new Request(url)),
        ),
      );
    }),
  );

describe("Workbench Jira OAuth callback", () => {
  it.effect("rejects malformed state before invoking authorization", () =>
    Effect.gen(function* () {
      for (const state of [
        "x/../../../secret",
        "a".repeat(31),
        "a".repeat(33),
        "a".repeat(31) + ".",
        " " + "a".repeat(32),
      ]) {
        const response = yield* getCallbackResponse(
          () => Effect.die("malformed state reached authorization"),
          `http://localhost/oauth/workbench/jira/callback?code=code&state=${encodeURIComponent(state)}`,
        );
        assert.strictEqual(response.status, 400);
        expectNoStoreHeaders(response);
      }
    }),
  );

  it.effect("rejects incomplete callbacks before completing authorization", () =>
    Effect.gen(function* () {
      const completeAuth = () => Effect.die("unexpected auth completion");
      const response = yield* getCallbackResponse(
        completeAuth,
        "http://localhost/oauth/workbench/jira/callback?state=Abcdef01234567_-Abcdef01234567_-&tracking=private-value",
      );

      assert.strictEqual(response.status, 400);
      assert.strictEqual(
        responseText(response),
        "Jira authorization callback was incomplete. Return to the desktop app and try again.",
      );
      expectNoStoreHeaders(response);
    }),
  );

  it.effect("renders a safe cancellation response without calling Jira", () =>
    Effect.gen(function* () {
      const completeAuth = () => Effect.die("unexpected auth completion");
      const response = yield* getCallbackResponse(
        completeAuth,
        "http://localhost/oauth/workbench/jira/callback?error=access_denied&state=Abcdef01234567_-Abcdef01234567_-&error_description=private-value",
      );
      const body = responseText(response);

      assert.strictEqual(response.status, 400);
      assert.strictEqual(
        body,
        "Jira authorization was cancelled. Return to the desktop app and try again.",
      );
      assert.isFalse(body.includes("private-value"));
      assert.isFalse(body.includes("Abcdef01234567_-Abcdef01234567_-"));
      expectNoStoreHeaders(response);
    }),
  );

  it.effect("completes authorization without requiring an authenticated session", () =>
    Effect.gen(function* () {
      let received: WorkbenchJiraCompleteAuthInput | null = null;
      const completeAuth = (input: WorkbenchJiraCompleteAuthInput) =>
        Effect.sync(() => {
          received = input;
          return { connections: [] };
        });
      const response = yield* getCallbackResponse(
        completeAuth,
        "http://localhost/oauth/workbench/jira/callback?code=oauth-code&state=Abcdef01234567_-Abcdef01234567_-&query-secret=private-value",
      );

      assert.strictEqual(response.status, 200);
      assert.strictEqual(responseText(response), "Jira connected. Return to the desktop app.");
      assert.deepStrictEqual(received, {
        code: "oauth-code",
        state: "Abcdef01234567_-Abcdef01234567_-",
        redirectUri: "http://localhost/oauth/workbench/jira/callback",
      });
      expectNoStoreHeaders(response);
    }),
  );

  it.effect("renders an actionable service error without echoing callback values", () =>
    Effect.gen(function* () {
      const completeAuth = (_input: WorkbenchJiraCompleteAuthInput) =>
        Effect.fail(
          new WorkbenchJiraOperationError({
            code: "invalid_oauth_state",
            message: "The Jira authorization request is invalid or has already been used.",
          }),
        );
      const response = yield* getCallbackResponse(
        completeAuth,
        "http://localhost/oauth/workbench/jira/callback?code=oauth-code&state=Abcdef01234567_-Abcdef01234567_-",
      );
      const body = responseText(response);

      assert.strictEqual(response.status, 400);
      assert.strictEqual(
        body,
        "The Jira authorization request is invalid or has already been used. Return to the desktop app and try again.",
      );
      assert.isFalse(body.includes("oauth-code"));
      assert.isFalse(body.includes("Abcdef01234567_-Abcdef01234567_-"));
      expectNoStoreHeaders(response);
    }),
  );
});
