import { WorkbenchOperationError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

export const failureMessage = (failure: {
  readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"];
}) => {
  const error = squashAtomCommandFailure(failure);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The Workbench request failed.";
};

const isWorkbenchOperationError = Schema.is(WorkbenchOperationError);

/** The Workbench error code of a failed command, such as `ticket_changed` for a stale revision. */
export const failureCode = (failure: {
  readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"];
}) => {
  const error = squashAtomCommandFailure(failure);
  return isWorkbenchOperationError(error) ? error.code : null;
};

export const reportWorkbenchCommandFailure = <A, E>(
  result: AtomCommandResult<A, E>,
  setError: (message: string) => void,
): result is Extract<AtomCommandResult<A, E>, { readonly _tag: "Failure" }> => {
  if (result._tag !== "Failure") return false;
  if (!isAtomCommandInterrupted(result)) setError(failureMessage(result));
  return true;
};
