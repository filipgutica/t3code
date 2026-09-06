import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { JiraConfig } from "@t3tools/workbench/jira/JiraConfig";

/** Reads the existing environment variables lazily for each auth operation. */
export const layer = Layer.effect(
  JiraConfig,
  Effect.gen(function* () {
    const environment = yield* HostProcessEnvironment;
    return JiraConfig.of({
      get: Effect.sync(() => {
        const clientId = environment.T3_WORKBENCH_JIRA_CLIENT_ID?.trim() ?? "";
        const clientSecret = environment.T3_WORKBENCH_JIRA_CLIENT_SECRET?.trim() ?? "";
        return clientId.length > 0 && clientSecret.length > 0 ? { clientId, clientSecret } : null;
      }),
    });
  }),
);
