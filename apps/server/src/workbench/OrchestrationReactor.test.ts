import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { OrchestrationReactor } from "../orchestration/Services/OrchestrationReactor.ts";
import { TicketExecutionReactor } from "./TicketExecutionReactor.ts";
import { make } from "./OrchestrationReactor.ts";

describe("Workbench orchestration composition", () => {
  it.effect("subscribes ticket execution before starting upstream event producers", () =>
    Effect.gen(function* () {
      const started: string[] = [];
      const reactor = yield* make.pipe(
        Effect.provideService(OrchestrationReactor, {
          start: () =>
            Effect.sync(() => {
              started.push("upstream");
            }),
        }),
        Effect.provideService(TicketExecutionReactor, {
          start: () =>
            Effect.sync(() => {
              started.push("tickets");
            }),
          drain: Effect.void,
          drainThrough: () => Effect.void,
        }),
      );
      yield* reactor.start();
      assert.deepStrictEqual(started, ["tickets", "upstream"]);
    }).pipe(Effect.scoped),
  );
});
