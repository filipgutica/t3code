import { useNavigate } from "@tanstack/react-router";
import type {
  EnvironmentId,
  PullRequestReviewThread,
  ThreadId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import {
  ArrowRightIcon,
  CirclePauseIcon,
  FileCheck2Icon,
  MessageCircleQuestionIcon,
  MessageSquareIcon,
  ShieldQuestionIcon,
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
import {
  groupWorkbenchAttentionSignals,
  getWorkbenchAttentionSignalLabel,
  getWorkbenchAttentionSourceLabel,
  getWorkbenchAttentionSourceParts,
  type WorkbenchAttentionSignal,
  type WorkbenchAttentionInspection,
} from "./workbenchAttention.logic";
import {
  getWorkbenchAttentionBadgePresentation,
  getWorkbenchAttentionSignalPresentation,
  getWorkbenchThreadAttention,
} from "./workbenchAttentionPresentation.logic";
import type { WorkbenchThreadExecutionStatus } from "./workbenchThreadStatus.logic";

type TicketAttentionProps = {
  environmentId: EnvironmentId;
  ticketId: WorkbenchTicketId;
  ticketTitle: string;
  onOpenThread?: (threadId: ThreadId) => void;
};
const signalIcons = {
  input: MessageCircleQuestionIcon,
  approval: ShieldQuestionIcon,
  failed: CircleAlertIcon,
  message: MessageSquareIcon,
  plan: FileCheck2Icon,
  interrupted: CirclePauseIcon,
} as const;
const actionDescriptions = {
  question: "Open Thread to answer the question",
  reply: "Open Thread to read the reply",
  "failed-checks": "View checks and logs",
  "changes-requested": "View the requested changes",
} as const;
const waitingActionDescriptions = {
  approval: "Open Thread to review the approval",
  plan: "Open Thread to review the plan",
  failed: "Open Thread to inspect the failed run",
  interrupted: "Open Thread to review the interrupted run",
} as const;

const getAttentionActionDescription = (signal: WorkbenchAttentionSignal) => {
  switch (signal.kind) {
    case "unresolved-feedback": {
      const count = signal.unresolvedReviewThreads.length;
      return `${count} ${count === 1 ? "discussion" : "discussions"}`;
    }
    case "waiting":
      return waitingActionDescriptions[signal.cause];
    default:
      return actionDescriptions[signal.kind];
  }
};

function AttentionDiscussionButton({
  thread,
  sourceLabel,
  onOpen,
}: {
  thread: PullRequestReviewThread;
  sourceLabel: string;
  onOpen: () => void;
}) {
  const descriptionId = useId();
  const location = `${thread.path}${thread.line ? `:${thread.line}` : ""}`;
  return (
    <button
      type="button"
      aria-label={`Open pull request for review discussion at ${location}, ${sourceLabel}`}
      aria-describedby={descriptionId}
      className="flex min-h-11 w-full cursor-pointer items-start gap-2 rounded-md py-2 pl-7.5 pr-2 text-left text-2xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      onClick={onOpen}
    >
      <span className="min-w-0 flex-1">
        <span className="block break-words font-mono text-muted-foreground">{location}</span>
        <span id={descriptionId} className="mt-0.5 line-clamp-2 whitespace-normal break-words">
          {thread.comments[0]?.body ?? "Review discussion"}
        </span>
      </span>
      <ArrowRightIcon aria-hidden className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
    </button>
  );
}

function AttentionSignalItem({
  signal,
  onOpenSignal,
}: {
  signal: WorkbenchAttentionSignal;
  onOpenSignal: (signal: WorkbenchAttentionSignal) => void;
}) {
  const presentation = getWorkbenchAttentionSignalPresentation(signal);
  const Icon = signalIcons[presentation.icon];
  const { label } = presentation;
  const sourceLabel = getWorkbenchAttentionSourceLabel(signal.source);
  const discussions =
    signal.source.type === "pull-request" && signal.kind === "unresolved-feedback"
      ? signal.unresolvedReviewThreads
      : [];
  const actionDescription = getAttentionActionDescription(signal);
  return (
    <div>
      <button
        type="button"
        aria-label={`${label}. ${actionDescription}. ${sourceLabel}`}
        className="group/attention-item flex w-full cursor-pointer items-start gap-2 rounded-md p-2 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:py-3.5 max-md:py-3.5"
        onClick={() => onOpenSignal(signal)}
      >
        <Icon aria-hidden className={`mt-px size-3.5 shrink-0 ${presentation.className}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{label}</span>
            <span className="shrink-0 font-medium text-foreground/70 group-hover/attention-item:text-foreground">
              {presentation.action}
            </span>
          </span>
          {discussions.length > 0 ? (
            <span className="mt-0.5 block text-2xs text-muted-foreground">{actionDescription}</span>
          ) : null}
        </span>
      </button>
      {discussions.map((thread) => (
        <AttentionDiscussionButton
          key={thread.id}
          thread={thread}
          sourceLabel={sourceLabel}
          onOpen={() => onOpenSignal(signal)}
        />
      ))}
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
  const groups = groupWorkbenchAttentionSignals(signals);
  const openSignal = (signal: WorkbenchAttentionSignal) => {
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
    });
  };
  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ key, signals: group }) => {
        const source = group[0]!.source;
        const { prefix, title, repository } = getWorkbenchAttentionSourceParts(source);
        return (
          <section
            key={key}
            className="flex min-w-0 flex-col gap-1 border-t border-border/50 pt-3 first:border-t-0 first:pt-0"
          >
            <div className="px-2">
              <h3 className="break-words text-xs leading-5">
                <span className="font-semibold">{prefix}</span>
                {title ? <span className="text-foreground/80"> · {title}</span> : null}
              </h3>
              {repository ? (
                <p className="break-words text-2xs text-muted-foreground">{repository}</p>
              ) : null}
            </div>
            {group.map((signal) => (
              <AttentionSignalItem
                key={signal.kind === "waiting" ? `${signal.kind}:${signal.cause}` : signal.kind}
                signal={signal}
                onOpenSignal={openSignal}
              />
            ))}
          </section>
        );
      })}
      {inspections
        .filter((inspection) => inspection.displayStatus !== "complete")
        .map(({ row, displayStatus: status }) => (
          <p key={row.pullRequest.url} role="status" className="text-2xs text-muted-foreground">
            {getWorkbenchAttentionSourceLabel({ type: "pull-request", row })}:{" "}
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

function AttentionBadge({
  environmentId,
  title,
  signals,
  inspections,
  onOpenThread,
  side = "bottom",
  compact = false,
}: Pick<TicketAttentionProps, "environmentId" | "onOpenThread"> & {
  title: string;
  signals: readonly WorkbenchAttentionSignal[];
  inspections: readonly WorkbenchAttentionInspection[];
  side?: "bottom" | "right";
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { count, leading, reasons } = getWorkbenchAttentionBadgePresentation(signals);
  if (leading === null) return null;
  const Icon = signalIcons[leading.icon];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-workbench-attention-badge=""
            className={`relative inline-flex h-5 min-w-5 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-sm px-1 text-2xs font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 ${leading.className}`}
            aria-label={`Needs attention, ${count} ${count === 1 ? "item" : "items"} for ${title}: ${reasons}`}
          />
        }
      >
        <Icon aria-hidden className="size-3" />
        {!compact || count > 1 ? <span aria-hidden>{count}</span> : null}
      </PopoverTrigger>
      <PopoverPopup width="md" padding="compact" side={side} align="end">
        <div className="mb-3 flex flex-col gap-1 border-b px-2 pt-2 pb-3">
          <PopoverTitle>Needs attention</PopoverTitle>
          <p className="break-words text-xs text-muted-foreground">{title}</p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          <AttentionItems
            environmentId={environmentId}
            {...(onOpenThread ? { onOpenThread } : {})}
            signals={signals}
            inspections={inspections}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** Thread notifications clear on a visit; PR feedback remains until its source resolves. */
export function WorkbenchTicketAttentionBadge(
  props: TicketAttentionProps & { side?: "bottom" | "right"; compact?: boolean },
) {
  const { attentionSignalsByTicket, attentionInspectionsByTicket } = useWorkbenchAttentionData();
  return (
    <AttentionBadge
      {...props}
      title={props.ticketTitle}
      signals={attentionSignalsByTicket.get(props.ticketId) ?? []}
      inspections={attentionInspectionsByTicket.get(props.ticketId) ?? []}
    />
  );
}

export function WorkbenchThreadAttentionBadge({
  threadId,
  threadTitle,
  statusKind,
  ticketId,
  ...props
}: {
  environmentId: EnvironmentId;
  ticketId: WorkbenchTicketId;
  threadId: ThreadId;
  threadTitle: string;
  statusKind: WorkbenchThreadExecutionStatus["kind"] | null;
  side?: "bottom" | "right";
  compact?: boolean;
}) {
  const { attentionSignalsByTicket, attentionInspectionsByTicket } = useWorkbenchAttentionData();
  const attention = getWorkbenchThreadAttention({
    threadId,
    statusKind,
    signals: attentionSignalsByTicket.get(ticketId) ?? [],
    inspections: attentionInspectionsByTicket.get(ticketId) ?? [],
  });
  return <AttentionBadge {...props} {...attention} title={threadTitle} />;
}

export function WorkbenchTicketAttentionPanel(props: TicketAttentionProps) {
  const [collapsed, setCollapsed] = useWorkbenchTicketPanelCollapsed("attention");
  const contentId = useId();
  const { attentionSignalsByTicket, attentionInspectionsByTicket, refreshAttention } =
    useWorkbenchAttentionData();
  const signals = attentionSignalsByTicket.get(props.ticketId) ?? [];
  const inspections = attentionInspectionsByTicket.get(props.ticketId) ?? [];
  const loading = inspections.some((inspection) => inspection.status === "loading");
  const firstSignal = groupWorkbenchAttentionSignals(signals)[0]?.signals[0];
  if (!signals.length && inspections.every((inspection) => inspection.displayStatus === "complete"))
    return null;
  return (
    <div className="shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card/30">
      <WorkbenchTicketPanelHeader
        title={signals.length ? "Needs attention" : "PR inspection"}
        count={signals.length || undefined}
        description={
          collapsed && firstSignal ? (
            <span className="block whitespace-normal break-words">
              {attentionSignalSummary(firstSignal)}
            </span>
          ) : undefined
        }
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
        contentId={contentId}
        actions={
          <Button
            aria-label="Refresh ticket attention"
            title="Refresh ticket attention"
            aria-busy={loading}
            disabled={loading}
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
  return `${getWorkbenchAttentionSignalLabel(signal)} · ${getWorkbenchAttentionSourceLabel(signal.source)}`;
}
