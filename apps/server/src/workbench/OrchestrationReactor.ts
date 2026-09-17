import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { OrchestrationReactor } from "../orchestration/Services/OrchestrationReactor.ts";
import { OrchestrationReactorLive } from "../orchestration/Layers/OrchestrationReactor.ts";
import { TicketExecutionReactor } from "./TicketExecutionReactor.ts";

export const make = Effect.gen(function* () {
  const upstream = yield* OrchestrationReactor;
  const tickets = yield* TicketExecutionReactor;
  return {
    start: Effect.fn("WorkbenchOrchestrationReactor.start")(function* () {
      yield* tickets.start();
      yield* upstream.start();
    }),
  } satisfies OrchestrationReactor["Service"];
});

export const layer = Layer.effect(OrchestrationReactor, make).pipe(
  Layer.provide(OrchestrationReactorLive),
);
