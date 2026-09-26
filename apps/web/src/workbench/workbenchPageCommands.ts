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

export const reportWorkbenchCommandFailure = <A, E>(
  result: AtomCommandResult<A, E>,
  setError: (message: string) => void,
): result is Extract<AtomCommandResult<A, E>, { readonly _tag: "Failure" }> => {
  if (result._tag !== "Failure") return false;
  if (!isAtomCommandInterrupted(result)) setError(failureMessage(result));
  return true;
};
