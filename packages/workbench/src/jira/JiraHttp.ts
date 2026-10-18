import { WorkbenchJiraOperationError } from "@t3tools/contracts";

export const JIRA_HTTP_TIMEOUT = "30 seconds";

const parseRetryAfter = (value: string | undefined, now: number): number => {
  if (value === undefined) return 0;
  if (/^\d+(?:\.\d+)?$/u.test(value.trim())) {
    const milliseconds = Number(value) * 1_000;
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
};

// Retry timing stays in-process; RPC encoding retains the public error fields.
export const makeJiraHttpError = (input: {
  readonly httpStatus: number;
  readonly message: string;
  readonly retryAfter: string | undefined;
  readonly now: number;
}) =>
  Object.assign(
    new WorkbenchJiraOperationError({
      code: "request_failed",
      httpStatus: input.httpStatus,
      message: input.message,
    }),
    { retryAfterMs: input.httpStatus === 429 ? parseRetryAfter(input.retryAfter, input.now) : 0 },
  );
