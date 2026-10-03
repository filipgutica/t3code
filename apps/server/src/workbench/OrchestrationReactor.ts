import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { TicketExecutionReactor } from "./TicketExecutionReactor.ts";

// Native V2 owns its producers. Subscribe the Workbench overlay during server
// layer construction; its parked stream catches events from the activation cursor.
export const make = Effect.gen(function* () {
  const tickets = yield* TicketExecutionReactor;
  return { start: tickets.start };
});

export const layer = Layer.effectDiscard(make.pipe(Effect.flatMap((reactor) => reactor.start())));
