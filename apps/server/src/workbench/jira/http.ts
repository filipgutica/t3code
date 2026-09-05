import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { WorkbenchJiraService } from "./WorkbenchJiraService.ts";

const CALLBACK_PATH = "/oauth/workbench/jira/callback";
const CALLBACK_HEADERS = {
  "cache-control": "no-store",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
} as const;

const callbackResponse = (body: string, status: number) =>
  HttpServerResponse.text(body, { status, headers: CALLBACK_HEADERS });

const failedCallbackResponse = (message: string) =>
  callbackResponse(`${message} Return to the desktop app and try again.`, 400);

export const workbenchJiraOAuthRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const workbenchJira = yield* WorkbenchJiraService;
    return HttpRouter.add(
      "GET",
      CALLBACK_PATH,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = HttpServerRequest.toURL(request);
        if (Option.isNone(url)) {
          return failedCallbackResponse("Jira authorization could not be completed.");
        }

        const code = url.value.searchParams.get("code")?.trim() ?? "";
        const state = url.value.searchParams.get("state")?.trim() ?? "";
        const authorizationError = url.value.searchParams.get("error")?.trim() ?? "";
        if (authorizationError.length > 0) {
          return failedCallbackResponse(
            authorizationError === "access_denied"
              ? "Jira authorization was cancelled."
              : "Jira authorization could not be completed.",
          );
        }
        if (code.length === 0 || state.length === 0) {
          return failedCallbackResponse("Jira authorization callback was incomplete.");
        }

        const redirectUri = `${url.value.origin}${url.value.pathname}`;
        return yield* workbenchJira.completeAuth({ code, state, redirectUri }).pipe(
          Effect.as(callbackResponse("Jira connected. Return to the desktop app.", 200)),
          Effect.catch((error) => Effect.succeed(failedCallbackResponse(error.message))),
        );
      }),
    );
  }),
);
