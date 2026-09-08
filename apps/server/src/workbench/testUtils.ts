import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { TicketExecutionReactor } from "./TicketExecutionReactor.ts";

export const noopTicketExecutionReactorLayer = Layer.succeed(TicketExecutionReactor, {
  start: () => Effect.void,
  drain: Effect.void,
  drainThrough: () => Effect.void,
});
