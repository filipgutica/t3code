import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";

import { interruptOnAbort } from "./interruptOnAbort";

describe("interruptOnAbort", () => {
  it.effect("interrupts the request and runs its finalizer when the signal aborts", () => {
    // Cancel comes from outside Effect: the Ask for change popover's button.
    const controller = new AbortController();
    return Effect.gen(function* () {
      let finalized = false;
      const request = Effect.never.pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            finalized = true;
          }),
        ),
      );
      const fiber = yield* request.pipe(interruptOnAbort(controller.signal), Effect.forkChild);
      yield* Effect.yieldNow;
      controller.abort();
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(finalized).toBe(true);
    });
  });

  it.effect("returns the request's result when the signal never aborts", () => {
    const { signal } = new AbortController();
    return Effect.gen(function* () {
      const value = yield* Effect.succeed("rewritten").pipe(interruptOnAbort(signal));
      expect(value).toBe("rewritten");
    });
  });
});
