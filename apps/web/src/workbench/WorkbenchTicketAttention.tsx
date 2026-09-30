import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId, WorkbenchTicketId } from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import {
  ArrowRightIcon,
  BellIcon,
  ChevronDownIcon,
  MessageSquareIcon,
  CheckCheckIcon,
  CircleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../components/ui/collapsible";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { useWorkbenchAttentionData } from "./WorkbenchAttentionProvider";
import { useOpenWorkbenchPullRequest } from "./WorkbenchPullRequestPreview";
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
  "review-ready": "Ready for your review",
  "failed-checks": "Failed checks",
  "changes-requested": "Changes requested",
  "unresolved-feedback": "Unresolved feedback",
} as const;

const signalIcons = {
  waiting: MessageSquareIcon,
  "review-ready": CheckCheckIcon,
  "failed-checks": CircleAlertIcon,
  "changes-requested": CircleAlertIcon,
  "unresolved-feedback": MessageSquareIcon,
} as const;
const actionDescriptions = {
  waiting: "Open Thread to respond",
  "review-ready": "Open Thread to inspect completed work",
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
      <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
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

/** The count represents source-specific actionable signals, never unread notifications. */
export function WorkbenchTicketAttentionBadge(
  props: TicketAttentionProps & { side?: "bottom" | "right"; compact?: boolean },
) {
  const { attentionSignalsByTicket, attentionInspectionsByTicket } = useWorkbenchAttentionData();
  const signals = attentionSignalsByTicket.get(props.ticketId) ?? [];
  const [open, setOpen] = useState(false);
  if (signals.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size={props.compact ? "icon-micro" : "micro"}
            variant={props.compact ? "ghost" : "warning-outline"}
            aria-label={`${signals.length} attention ${signals.length === 1 ? "item" : "items"} for ${props.ticketTitle}`}
          />
        }
      >
        <BellIcon aria-hidden className={props.compact ? "size-3 text-warning" : undefined} />
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
  const { attentionSignalsByTicket, attentionInspectionsByTicket, refreshAttention } =
    useWorkbenchAttentionData();
  const signals = attentionSignalsByTicket.get(props.ticketId) ?? [];
  const inspections = attentionInspectionsByTicket.get(props.ticketId) ?? [];
  if (!signals.length && inspections.every((inspection) => inspection.status === "complete"))
    return null;
  return (
    <div className="shrink-0 overflow-hidden rounded-xl border border-border/70 bg-card/30">
      <Collapsible defaultOpen>
        <div className="flex items-center justify-between gap-2 px-3 py-3">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-semibold">
            {signals.length ? (
              <BellIcon aria-hidden className="size-3.5 text-warning" />
            ) : (
              <CircleAlertIcon aria-hidden className="size-3.5 text-muted-foreground" />
            )}
            {signals.length ? "Needs attention" : "PR inspection"}
            {signals.length ? <span className="text-warning">{signals.length}</span> : null}
            <ChevronDownIcon
              aria-hidden
              className="ml-auto size-3.5 text-muted-foreground group-data-[panel-open]:rotate-180"
            />
          </CollapsibleTrigger>
          <Button size="micro" variant="ghost" onClick={refreshAttention}>
            Refresh
          </Button>
        </div>
        <CollapsiblePanel>
          <div className="max-h-80 overflow-y-auto border-t px-3 py-3">
            <AttentionItems {...props} signals={signals} inspections={inspections} />
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}
