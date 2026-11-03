import * as Effect from "effect/Effect";

/** Interrupts `effect` when `signal` aborts; an RPC request interrupted this way stops on the server. */
export const interruptOnAbort =
  (signal: AbortSignal) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.raceFirst(
      effect,
      Effect.callback<never>((resume) => {
        const abort = () => resume(Effect.interrupt);
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
        return Effect.sync(() => signal.removeEventListener("abort", abort));
      }),
    );
