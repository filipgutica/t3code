const EXECUTION_PRESENTATION = {
  working: { label: "Working", icon: "working", className: "text-info" },
  waiting: { label: "Waiting", icon: "waiting", className: "text-muted-foreground" },
  approval: { label: "Approval", icon: "approval", className: "text-warning-foreground" },
  input: { label: "Input", icon: "input", className: "text-indigo-600 dark:text-indigo-300" },
  request: { label: "Request", icon: "request", className: "text-guest-foreground" },
  limited: { label: "Limited", icon: "failed", className: "text-warning" },
  failed: { label: "Failed", icon: "failed", className: "text-error" },
} as const;

export function resolveWorkbenchThreadExecutionStatusPresentation({
  kind,
  goalActive = false,
}: {
  kind: keyof typeof EXECUTION_PRESENTATION;
  goalActive?: boolean;
}) {
  const presentation = EXECUTION_PRESENTATION[kind];
  return {
    ...presentation,
    kind,
    label: kind === "working" && goalActive ? "Goal" : presentation.label,
  };
}

export type WorkbenchThreadExecutionStatusPresentation = ReturnType<
  typeof resolveWorkbenchThreadExecutionStatusPresentation
>;
