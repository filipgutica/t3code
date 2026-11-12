import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";

/** The environment ID of the test server, which Workbench treats as its host. */
export const hostEnvironmentId = EnvironmentId.make("environment-host");

export const hostEnvironmentLayer = Layer.mock(ServerEnvironment)({
  getEnvironmentId: Effect.succeed(hostEnvironmentId),
});
