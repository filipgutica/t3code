import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId, WorkbenchTicketId } from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import {
  ArrowRightIcon,
  BellIcon,
  MessageSquareIcon,
  CircleHelpIcon,
  CircleAlertIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { Button } from "../components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { useWorkbenchAttentionData } from "./WorkbenchAttentionProvider";
import { useOpenWorkbenchPullRequest } from "./WorkbenchPullRequestPreview";
import {
  WorkbenchTicketPanelHeader,
  useWorkbenchTicketPanelCollapsed,
} from "./WorkbenchTicketPanelHeader";
import type {
  WorkbenchAttentionSignal,
  WorkbenchAttentionInspection,
} from "./workbenchAttention.logic";

type TicketAttentionProps = {
  environmentId: EnvironmentId;
  ticketId: WorkbenchTicketId;
  ticketTitle: string;
  onOpenThread?: (threadId: ThreadId) => void;
};
const labels = {
  waiting: "Waiting for your input",
  question: "Waiting for your answer",
  reply: "Agent replied",
  "failed-checks": "Failed checks",
  "changes-requested": "Changes requested",
  "unresolved-feedback": "Unresolved feedback",
} as const;

const signalIcons = {
  waiting: MessageSquareIcon,
  question: CircleHelpIcon,
  reply: MessageSquareIcon,
  "failed-checks": CircleAlertIcon,
  "changes-requested": MessageSquareIcon,
  "unresolved-feedback": MessageSquareIcon,
} as const;
const actionDescriptions = {
  waiting: "Open Thread to respond",
  question: "Open Thread to answer the question",
  reply: "Open Thread to read the reply",
  "failed-checks": "View checks, logs, and rerun options",
  "changes-requested": "View the requested changes",
} as const;

function AttentionSignalItem({
  signal,
  onOpenSignal,
}: {
  signal: WorkbenchAttentionSignal;
  onOpenSignal: (signal: WorkbenchAttentionSignal, reviewThreadId?: string) => void;
}) {
  const Icon = signalIcons[signal.kind];
  const discussions =
    signal.source.type === "pull-request" && signal.kind === "unresolved-feedback"
      ? signal.unresolvedReviewThreads
      : [];
  const content = (
    <>
      <Icon
        aria-hidden
        className={`mt-0.5 size-3.5 shrink-0 ${signal.kind === "failed-checks" ? "text-warning" : "text-muted-foreground"}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{labels[signal.kind]}</span>
        <span className="block text-2xs text-muted-foreground">
          {signal.kind === "unresolved-feedback"
            ? `${discussions.length} unresolved ${discussions.length === 1 ? "discussion · Open feedback" : "discussions · Choose a discussion"}`
            : actionDescriptions[signal.kind]}
        </span>
      </span>
      {discussions.length <= 1 ? (
        <ArrowRightIcon aria-hidden className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
      ) : null}
    </>
  );
  return (
    <div>
      {discussions.length > 1 ? (
        <div className="flex items-start gap-2 p-2 text-xs">{content}</div>
      ) : (
        <button
          type="button"
          className="flex w-full cursor-pointer items-start gap-2 rounded-md p-2 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => onOpenSignal(signal, discussions[0]?.id)}
        >
          {content}
        </button>
      )}
      {discussions.length > 1
        ? discussions.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className="block w-full cursor-pointer whitespace-normal break-words rounded-md py-1 pl-7 pr-2 text-left text-2xs text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => onOpenSignal(signal, thread.id)}
            >
              {thread.path}
              {thread.line ? `:${thread.line}` : ""} ·{" "}
              {thread.comments[0]?.body ?? "Review discussion"}
            </button>
          ))
        : null}
    </div>
  );
}

function AttentionItems({
  environmentId,
  signals,
  inspections,
  onOpenThread,
  onNavigate,
}: Pick<TicketAttentionProps, "environmentId" | "onOpenThread"> & {
  signals: readonly WorkbenchAttentionSignal[];
  inspections: readonly WorkbenchAttentionInspection[];
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const openPullRequest = useOpenWorkbenchPullRequest();
  const openThread = (threadId: ThreadId) => {
    onNavigate?.();
    if (onOpenThread) onOpenThread(threadId);
    else
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
        search: { workbench: true },
      });
  };
  const groups = new Map<string, WorkbenchAttentionSignal[]>();
  for (const signal of signals) {
    const key =
      signal.source.type === "thread"
        ? `thread:${signal.source.threadId}`
        : signal.source.row.pullRequest.url;
    groups.set(key, [...(groups.get(key) ?? []), signal]);
  }
  const openSignal = (signal: WorkbenchAttentionSignal, reviewThreadId?: string) => {
    if (signal.source.type === "thread") {
      openThread(signal.source.threadId);
      return;
    }
    const { row } = signal.source;
    const host = parseChangeRequestUrl(row.pullRequest.url)?.host;
    onNavigate?.();
    openPullRequest?.({
      environmentId,
      reference: {
        projectId: row.pullRequest.projectId,
        repository: row.pullRequest.repository,
        number: row.pullRequest.number,
        ...(host === undefined ? {} : { host }),
      },
      linkedThread: {
        threadId: row.threadId,
        title: row.threadTitle,
        onOpen: () => openThread(row.threadId),
      },
      focus:
        signal.kind === "failed-checks"
          ? { kind: "checks" }
          : reviewThreadId
            ? { kind: "review-thread", reviewThreadId }
            : { kind: "review" },
    });
  };
  return (
    <div className="flex flex-col gap-3">
      {[...groups].map(([key, group]) => {
        const source = group[0]!.source;
        return (
          <div key={key} className="flex min-w-0 flex-col gap-1">
            <p className="break-words text-2xs font-medium text-muted-foreground">
              {source.type === "thread"
                ? `Thread · ${source.threadTitle}`
                : `PR #${source.row.pullRequest.number} · ${source.row.pullRequest.repository}`}
            </p>
            {group.map((signal) => (
              <AttentionSignalItem key={signal.kind} signal={signal} onOpenSignal={openSignal} />
            ))}
          </div>
        );
      })}
      {inspections
        .filter((inspection) => inspection.status !== "complete")
        .map(({ row, status }) => (
          <p key={row.pullRequest.url} role="status" className="text-2xs text-muted-foreground">
            PR #{row.pullRequest.number}:{" "}
            {status === "loading"
              ? "Inspecting attention…"
              : status === "unavailable"
                ? "Inspection unavailable. Refresh to try again."
                : "Inspection incomplete. Some attention may be missing."}
          </p>
        ))}
    </div>
  );
}

function AttentionBell({
  compact,
  hasFailedChecks,
}: {
  compact: boolean;
  hasFailedChecks: boolean;
}) {
  return (
    <span aria-hidden className="relative inline-flex">
      <BellIcon
        className={
          compact
            ? `size-3 ${hasFailedChecks ? "text-warning" : "text-muted-foreground"}`
            : undefined
        }
      />
      {!hasFailedChecks ? (
        <span
          className={`absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-primary ring-2 ${compact ? "ring-sidebar" : "ring-popover"}`}
        />
      ) : null}
    </span>
  );
}

/** Thread notifications clear on a visit; PR feedback remains until its source resolves. */
export function WorkbenchTicketAttentionBadge(
  props: TicketAttentionProps & { side?: "bottom" | "right"; compact?: boolean },
) {
  const { attentionSignalsByTicket, attentionInspectionsByTicket } = useWorkbenchAttentionData();
  const signals = attentionSignalsByTicket.get(props.ticketId) ?? [];
  const [open, setOpen] = useState(false);
  const hasFailedChecks = signals.some((signal) => signal.kind === "failed-checks");
  if (signals.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size={props.compact ? "icon-micro" : "micro"}
            variant={props.compact ? "ghost" : hasFailedChecks ? "warning-outline" : "outline"}
            aria-label={`${signals.length} attention ${signals.length === 1 ? "item" : "items"} for ${props.ticketTitle}`}
          />
        }
      >
        <AttentionBell compact={!!props.compact} hasFailedChecks={hasFailedChecks} />
        {props.compact ? null : signals.length}
      </PopoverTrigger>
      <PopoverPopup width="md" padding="compact" side={props.side ?? "bottom"} align="end">
        <div className="mb-3 flex flex-col gap-1 border-b pb-3">
          <PopoverTitle>Needs your attention</PopoverTitle>
          <p className="truncate text-2xs text-muted-foreground">{props.ticketTitle}</p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          <AttentionItems
            {...props}
            signals={signals}
            inspections={attentionInspectionsByTicket.get(props.ticketId) ?? []}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

export function WorkbenchTicketAttentionPanel(props: TicketAttentionProps) {
  const [collapsed, setCollapsed] = useWorkbenchTicketPanelCollapsed("attention");
  const contentId = useId();
  const { attentionSignalsByTicket, attentionInspectionsByTicket, refreshAttention } =
    useWorkbenchAttentionData();
  const signals = attentionSignalsByTicket.get(props.ticketId) ?? [];
  const inspections = attentionInspectionsByTicket.get(props.ticketId) ?? [];
  if (!signals.length && inspections.every((inspection) => inspection.status === "complete"))
    return null;
  return (
    <div className="shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card/30">
      <WorkbenchTicketPanelHeader
        title={signals.length ? "Needs attention" : "PR inspection"}
        count={signals.length || undefined}
        description={collapsed && signals[0] ? attentionSignalSummary(signals[0]) : undefined}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
        contentId={contentId}
        actions={
          <Button
            aria-label="Refresh ticket attention"
            title="Refresh ticket attention"
            size="icon-xs"
            variant="outline"
            onClick={refreshAttention}
          >
            <RefreshCwIcon />
          </Button>
        }
      />
      <div id={contentId} hidden={collapsed} className="border-t border-border/50 px-4 py-3">
        <AttentionItems {...props} signals={signals} inspections={inspections} />
      </div>
    </div>
  );
}

function attentionSignalSummary(signal: WorkbenchAttentionSignal) {
  const source = signal.source;
  const sourceLabel =
    source.type === "thread"
      ? source.threadTitle
      : `PR #${source.row.pullRequest.number} · ${source.row.threadTitle}`;
  return `${labels[signal.kind]} · ${sourceLabel}`;
}
