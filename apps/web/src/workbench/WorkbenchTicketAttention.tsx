import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId, WorkbenchTicketId } from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import {
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  ListChecksIcon,
  MessageCircleQuestionIcon,
  MessageSquareTextIcon,
  RefreshCwIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";
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
  type WorkbenchAttentionReasonKind,
  type WorkbenchAttentionSignal,
} from "./workbenchAttention.logic";
import {
  getWorkbenchAttentionBadgePresentation,
  getWorkbenchAttentionReasonPresentation,
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
const reasonIcons = {
  approval: ShieldQuestionIcon,
  input: MessageCircleQuestionIcon,
  failed: CircleAlertIcon,
  checks: CircleXIcon,
  feedback: MessageSquareTextIcon,
  plan: ListChecksIcon,
  done: CircleCheckIcon,
} satisfies Record<WorkbenchAttentionReasonKind, unknown>;

function AttentionSignalItem({
  signal,
  onOpenSignal,
}: {
  signal: WorkbenchAttentionSignal;
  onOpenSignal: (signal: WorkbenchAttentionSignal) => void;
}) {
  const { icon, className, label, action } = getWorkbenchAttentionSignalPresentation(signal);
  const Icon = reasonIcons[icon];
  return (
    <button
      type="button"
      aria-label={`${label}. ${action}. ${getWorkbenchAttentionSourceLabel(signal.source)}`}
      className="group/attention-item flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      onClick={() => onOpenSignal(signal)}
    >
      <Icon aria-hidden className={`size-3.5 shrink-0 ${className}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="flex shrink-0 items-center text-muted-foreground group-hover/attention-item:text-foreground">
        {action}
        <ChevronRightIcon aria-hidden className="size-3" />
      </span>
    </button>
  );
}

function AttentionItems({
  environmentId,
  cardTitle,
  signals,
  onOpenThread,
  onNavigate,
}: Pick<TicketAttentionProps, "environmentId" | "onOpenThread"> & {
  cardTitle: string;
  signals: readonly WorkbenchAttentionSignal[];
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
    <div className="flex flex-col gap-2">
      {groupWorkbenchAttentionSignals(signals).map(({ key, signals: group }) => {
        const { prefix, title, repository } = getWorkbenchAttentionSourceParts(group[0]!.source);
        return (
          <section key={key} className="flex min-w-0 flex-col">
            <h3 className="truncate px-2 pb-0.5 text-2xs text-muted-foreground">
              <span className="font-semibold text-foreground/80">{prefix}</span>
              {title && title !== cardTitle ? ` · ${title}` : null}
              {repository ? ` · ${repository}` : null}
            </h3>
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
    </div>
  );
}

/**
 * The row's status slot: a plain native status, or a button that opens every reason. Like
 * native Woke, the button stays visible on row hover while plain statuses give way.
 */
function AttentionBadge({
  environmentId,
  title,
  signals,
  nativeStatusKind = null,
  nativeStatus = null,
  onOpenThread,
  side = "bottom",
}: Pick<TicketAttentionProps, "environmentId" | "onOpenThread"> & {
  title: string;
  signals: readonly WorkbenchAttentionSignal[];
  nativeStatusKind?: WorkbenchThreadExecutionStatus["kind"] | null | undefined;
  nativeStatus?: ReactNode;
  side?: "bottom" | "right";
}) {
  const [open, setOpen] = useState(false);
  const { kinds, leading, more, reasons } = getWorkbenchAttentionBadgePresentation({
    signals,
    nativeStatusKind,
  });
  // A reason the native status already shows still opens the card, so its source stays findable.
  if (signals.length === 0) return nativeStatus;
  const leadingPresentation = leading ? getWorkbenchAttentionReasonPresentation(leading) : null;
  const LeadingIcon = leading ? reasonIcons[leading] : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-workbench-attention-badge=""
            className={`inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-sm text-xs font-medium tabular-nums outline-none hover:[&_[data-attention-label]]:underline focus-visible:outline-2 focus-visible:outline-ring ${leadingPresentation?.className ?? ""}`}
          />
        }
      >
        {LeadingIcon && leadingPresentation ? (
          <>
            <LeadingIcon aria-hidden className="size-4 shrink-0" />
            <span data-attention-label="">{leadingPresentation.label}</span>
          </>
        ) : (
          <span data-attention-label="">{nativeStatus}</span>
        )}
        {more > 0 ? <span className="text-muted-foreground">+{more}</span> : null}
        <span className="sr-only">{`, ${title} needs attention: ${reasons}`}</span>
      </PopoverTrigger>
      <PopoverPopup width="md" padding="compact" side={side} align="end">
        <div className="px-2 pt-1 pb-2">
          <PopoverTitle>{title}</PopoverTitle>
        </div>
        <div className="max-h-80 overflow-y-auto">
          <AttentionItems
            environmentId={environmentId}
            cardTitle={title}
            {...(onOpenThread ? { onOpenThread } : {})}
            signals={signals}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** Thread notifications clear on a visit; PR feedback remains until its source resolves. */
export function WorkbenchTicketAttentionBadge(
  props: TicketAttentionProps & {
    side?: "bottom" | "right";
    nativeStatusKind?: WorkbenchThreadExecutionStatus["kind"] | null;
    nativeStatus?: ReactNode;
  },
) {
  const { attentionSignalsByTicket } = useWorkbenchAttentionData();
  return (
    <AttentionBadge
      {...props}
      title={props.ticketTitle}
      signals={attentionSignalsByTicket.get(props.ticketId) ?? []}
    />
  );
}

export function WorkbenchThreadAttentionBadge({
  threadId,
  threadTitle,
  ticketId,
  ...props
}: {
  environmentId: EnvironmentId;
  ticketId: WorkbenchTicketId;
  threadId: ThreadId;
  threadTitle: string;
  nativeStatusKind: WorkbenchThreadExecutionStatus["kind"] | null;
  nativeStatus: ReactNode;
  side?: "bottom" | "right";
}) {
  const { attentionSignalsByTicket } = useWorkbenchAttentionData();
  const { signals } = getWorkbenchThreadAttention({
    threadId,
    signals: attentionSignalsByTicket.get(ticketId) ?? [],
    inspections: [],
  });
  return <AttentionBadge {...props} signals={signals} title={threadTitle} />;
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
        <div className="flex flex-col gap-3">
          <AttentionItems {...props} cardTitle={props.ticketTitle} signals={signals} />
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
      </div>
    </div>
  );
}

function attentionSignalSummary(signal: WorkbenchAttentionSignal) {
  return `${getWorkbenchAttentionSignalLabel(signal)} · ${getWorkbenchAttentionSourceLabel(signal.source)}`;
}
