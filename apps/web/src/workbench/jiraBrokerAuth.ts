import { EnvironmentId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const JiraBrokerAuthState = Schema.Struct({
  environmentId: EnvironmentId,
  state: TrimmedNonEmptyString,
  expiresAt: TrimmedNonEmptyString,
});

export type JiraBrokerAuthState = typeof JiraBrokerAuthState.Type;

const decodeJiraBrokerAuthState = Schema.decodeUnknownSync(JiraBrokerAuthState);

/**
 * Restore only a well-formed, unexpired pending state. The value is stored in
 * session storage, so malformed or stale data must not restart a claim loop.
 */
export const decodePendingJiraBrokerAuth = ({
  serialized,
  nowEpochMs,
}: {
  readonly serialized: string;
  readonly nowEpochMs: number;
}): JiraBrokerAuthState | null => {
  try {
    const state = decodeJiraBrokerAuthState(JSON.parse(serialized));
    const expiresAtEpochMs = Date.parse(state.expiresAt);
    return Number.isFinite(expiresAtEpochMs) && expiresAtEpochMs > nowEpochMs ? state : null;
  } catch {
    return null;
  }
};

export const serializePendingJiraBrokerAuth = (state: JiraBrokerAuthState): string =>
  JSON.stringify(state);
