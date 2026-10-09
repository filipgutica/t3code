import type { SidebarV2TopStatusKind } from "./Sidebar.logic";

const EXECUTION_PRESENTATION = {
  working: { label: "Working", icon: "working", className: "text-info" },
  waiting: { label: "Waiting", icon: null, className: "text-muted-foreground" },
  approval: { label: "Approval", icon: "approval", className: "text-warning-foreground" },
  input: { label: "Input", icon: "input", className: "text-indigo-600 dark:text-indigo-300" },
  limited: { label: "Limited", icon: "failed", className: "text-warning" },
  failed: { label: "Failed", icon: "failed", className: "text-error" },
  woke: { label: "Woke", icon: "woke", className: "text-warning" },
  done: { label: "Done", icon: "done", className: "text-success" },
} as const;

/** Native status presentation; notification precedence remains with the caller. */
export function resolveThreadExecutionStatusPresentation({
  kind,
  goalActive = false,
}: {
  kind: SidebarV2TopStatusKind | null;
  goalActive?: boolean;
}) {
  if (kind === null) return null;
  const presentation = EXECUTION_PRESENTATION[kind];
  return {
    ...presentation,
    kind,
    label: kind === "working" && goalActive ? "Goal" : presentation.label,
  };
}

export type ThreadExecutionStatusPresentation = NonNullable<
  ReturnType<typeof resolveThreadExecutionStatusPresentation>
>;
