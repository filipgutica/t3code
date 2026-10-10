import { useAtomValue } from "@effect/atom-react";
import { useBlocker } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ServerProvider,
  ThreadId,
  WorkbenchEpic,
  WorkbenchEpicId,
  WorkbenchJiraBinding,
  WorkbenchProject,
  WorkbenchTicket,
} from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  PlayIcon,
  TicketPlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";

import ChatView from "../components/ChatView";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { Skeleton } from "../components/ui/skeleton";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { useComposerDraftStore } from "../composerDraftStore";
import { isElectron } from "../env";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { cn } from "../lib/utils";
import { toastManager } from "../components/ui/toast";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  isProviderInstancePickerReady,
  sortProviderInstanceEntries,
} from "../providerInstances";
import { useThreadShell } from "../state/entities";
import type { Project } from "../types";
import { WorkbenchDescription } from "./WorkbenchDescription";
import {
  WorkbenchRepositoryBadges,
  WorkbenchTicketProposalRenderer,
} from "./WorkbenchTicketProposal";
import { WorkbenchInlineError } from "./WorkbenchForms";
import {
  WorkbenchTicketDraftFieldsForm,
  getTicketDraftCreateState,
} from "./WorkbenchTicketDraftPanel";
import { workbenchEnvironment } from "./state";
import {
  useTicketDraftBegin,
  useTicketDraftEditor,
  useTicketDraftTransitions,
} from "./useWorkbenchTicketConversation";
import { DRAFT_CONFLICT_MESSAGE } from "./workbenchTicketDraftSync";
import {
  canDiscardConversationDraft,
  pickNewestConversationDraft,
  resolveTicketPlanningModelSelection,
  supportsEnforcedTicketPlanning,
  type WorkbenchConversationDraft,
} from "./workbenchTicketDraft.logic";

export interface WorkbenchTicketConversationProps {
  readonly environmentId: EnvironmentId;
  readonly workspace: WorkbenchProject;
  /** The draft in the Workbench snapshot; null before the Workspace has one. */
  readonly draft: WorkbenchConversationDraft | null;
  readonly requestedDraftId: WorkbenchConversationDraft["id"] | null;
  /** The saved ticket once Create ticket has completed. */
  readonly ticket: WorkbenchTicket | null;
  /** False for a host that predates conversation drafts; it only offers manual creation. */
  readonly draftsSupported: boolean;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly epics: ReadonlyArray<WorkbenchEpic>;
  readonly jiraEpics: ReadonlyArray<WorkbenchEpic>;
  readonly jiraBinding: WorkbenchJiraBinding | null;
  readonly localOnlySupported: boolean;
  readonly jiraOwnershipKnown: boolean;
  readonly initialEpicId: WorkbenchEpicId | null;
  readonly refreshSnapshot: () => void;
  readonly onClose: () => void;
  readonly onCreateManually: () => void;
  readonly onCreateEpic: (onCreated: (epicId: WorkbenchEpicId) => void) => void;
  readonly onDraftPrepared: (draft: WorkbenchConversationDraft) => void;
  readonly onTicketCreated: (draft: WorkbenchConversationDraft) => void;
  readonly onDiscarded: () => void;
  readonly onWorkStarted: (draft: WorkbenchConversationDraft) => void;
  /** Swaps to the saved ticket's details while it is still planning. */
  readonly onShowTicketDetails: () => void;
}

const PHASE_LABELS: Record<WorkbenchConversationDraft["phase"], string> = {
  creating: "Preparing",
  draft: "Draft",
  promoting: "Creating ticket",
  planning: "Planning",
  starting: "Starting work",
  working: "Working",
  discarding: "Discarding",
};

/** The Thread starts on the first provider the server can restrict to read-only planning. */
function usePlanningModelSelection({
  environmentId,
  providers,
  linkedProjects,
}: Pick<WorkbenchTicketConversationProps, "environmentId" | "providers" | "linkedProjects">) {
  const settings = useEnvironmentSettings(environmentId);
  const sticky = useComposerDraftStore((store) =>
    store.stickyActiveProvider === null
      ? null
      : (store.stickyModelSelectionByProvider[store.stickyActiveProvider] ?? null),
  );
  const entries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
      ),
    [providers, settings],
  );
  const modelSelection = useMemo(
    () =>
      resolveTicketPlanningModelSelection({
        candidates: entries.map((entry) => ({
          instanceId: entry.instanceId,
          driverKind: entry.driverKind,
          ready: isProviderInstancePickerReady(entry),
          defaultModel:
            entry.models.find((model) => model.isDefault && !model.isCustom)?.slug ??
            entry.models.find((model) => !model.isCustom)?.slug ??
            entry.models[0]?.slug ??
            null,
        })),
        preferred: [linkedProjects[0]?.defaultModelSelection, sticky],
      }),
    [entries, linkedProjects, sticky],
  );
  return { entries, modelSelection };
}

/**
 * Keyed by environment and Workspace: the same Workspace id can exist in two environments, and
 * neither the begin request nor a command reply may carry over from one to the other.
 */
export function WorkbenchTicketConversation(props: WorkbenchTicketConversationProps) {
  return (
    <ScopedTicketConversation
      key={`${props.environmentId}:${props.workspace.id}:${props.requestedDraftId ?? "new"}`}
      {...props}
    />
  );
}

function ScopedTicketConversation(props: WorkbenchTicketConversationProps) {
  const [fromCommand, setFromCommand] = useState<WorkbenchConversationDraft | null>(null);
  const inScope = (candidate: WorkbenchConversationDraft | null) =>
    candidate?.projectId === props.workspace.id ? candidate : null;
  const draft = pickNewestConversationDraft(inScope(props.draft), inScope(fromCommand));
  const { entries, modelSelection } = usePlanningModelSelection(props);
  const begin = useTicketDraftBegin({
    environmentId: props.environmentId,
    workspaceId: props.workspace.id,
    requestedDraftId: props.requestedDraftId,
    enabled: props.draftsSupported && (props.requestedDraftId === null || draft !== null),
    modelSelection,
    draft,
    initialEpicId: props.initialEpicId,
    onDraft: (created) => {
      setFromCommand(created);
      props.onDraftPrepared(created);
    },
    refreshSnapshot: props.refreshSnapshot,
  });
  if (draft === null) {
    // An empty provider list means the server's config has not arrived yet, not "none ready".
    const planningUnavailable =
      !props.draftsSupported || (modelSelection === null && props.providers.length > 0);
    return (
      <ConversationFrame title="New ticket" onClose={props.onClose}>
        {planningUnavailable ? (
          <UnsupportedPlanning
            hostOutdated={!props.draftsSupported}
            onCreateManually={props.onCreateManually}
            onClose={props.onClose}
          />
        ) : (
          <BeginProgress
            failure={begin.state.status === "failed" ? begin.state.message : null}
            onRetry={begin.retry}
            onCreateManually={props.onCreateManually}
          />
        )}
      </ConversationFrame>
    );
  }
  return (
    <WorkbenchTicketConversationBody
      key={draft.id}
      {...props}
      draft={draft}
      entries={entries}
      onDraft={setFromCommand}
      beginFailure={begin.state.status === "failed" ? begin.state.message : null}
      onRetryBegin={begin.retry}
    />
  );
}

function ConversationFrame({
  title,
  badge,
  onClose,
  actions,
  children,
}: {
  readonly title: string;
  readonly badge?: string;
  readonly onClose: () => void;
  readonly actions?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-workbench-ticket-conversation="">
      <WorkspacePageHeader electron={isElectron} className="border-b border-border">
        <Button aria-label="Back to board" size="icon-sm" variant="ghost" onClick={onClose}>
          <ArrowLeftIcon />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
        {badge ? <Badge variant="secondary">{badge}</Badge> : null}
        {actions}
      </WorkspacePageHeader>
      {children}
    </div>
  );
}

function BeginProgress({
  failure,
  onRetry,
  onCreateManually,
}: {
  readonly failure: string | null;
  readonly onRetry: () => void;
  readonly onCreateManually: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3 p-6">
      {failure ? (
        <>
          <WorkbenchInlineError message={failure} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onRetry}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={onCreateManually}>
              Create manually
            </Button>
          </div>
        </>
      ) : (
        <div role="status" aria-label="Preparing conversation" className="space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
    </div>
  );
}

function UnsupportedPlanning({
  hostOutdated,
  onCreateManually,
  onClose,
}: {
  readonly hostOutdated: boolean;
  readonly onCreateManually: () => void;
  readonly onClose: () => void;
}) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TicketPlusIcon />
        </EmptyMedia>
        <EmptyTitle>
          {hostOutdated
            ? "Update this environment to plan tickets"
            : "Ticket planning needs Codex or Claude"}
        </EmptyTitle>
        <EmptyDescription>
          {hostOutdated
            ? "This environment does not support planning conversations yet. Enter the ticket yourself, or update the environment."
            : "Planning is read-only, and only Codex and Claude can enforce that. Set one up in provider settings, or enter the ticket yourself."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={onCreateManually}>Create manually</Button>
          <Button variant="outline" onClick={onClose}>
            Back to board
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  );
}

function WorkbenchConversationPane({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const thread = useThreadShell(scopeThreadRef(environmentId, threadId));
  // ChatView needs the Thread shell; the server publishes it right after begin completes.
  if (thread === null) {
    return (
      <div role="status" aria-label="Preparing conversation" className="space-y-3 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  return (
    <ChatView
      key={threadId}
      environmentId={environmentId}
      threadId={threadId}
      routeKind="server"
      readOnlyPlanning
      hideHeader
    />
  );
}

/** What the saved ticket looks like while its conversation keeps planning. */
function WorkbenchPlanningSummary({
  summary,
  linkedProjects,
}: {
  readonly summary: {
    readonly title: string;
    readonly markdown: string;
    readonly repositoryProjectIds: ReadonlyArray<string>;
    readonly primaryT3ProjectId: string | null;
  };
  readonly linkedProjects: ReadonlyArray<Project>;
}) {
  return (
    <div className="min-w-0 space-y-4">
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Ticket</p>
        <p className="break-words text-base font-semibold">{summary.title}</p>
      </div>
      <WorkbenchRepositoryBadges
        label="Ticket repositories"
        ids={summary.repositoryProjectIds}
        primaryId={summary.primaryT3ProjectId}
        projects={linkedProjects}
      />
      <WorkbenchDescription markdown={summary.markdown} />
    </div>
  );
}

function ModelUnsupportedNotice() {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/8 p-3 text-sm text-warning-foreground"
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        The selected model cannot enforce read-only planning, so the server will not run this
        conversation. Choose a Codex or Claude model in the composer, or create the ticket manually.
      </span>
    </div>
  );
}

function DraftConflictNotice({
  onReload,
  onKeepMine,
  canKeepMine,
  fields,
}: {
  readonly onReload: () => void;
  readonly onKeepMine: () => void;
  readonly canKeepMine: boolean;
  readonly fields: WorkbenchConversationDraft["fields"];
}) {
  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-warning/40 bg-warning/8 p-3 text-sm text-warning-foreground"
    >
      <p>
        {canKeepMine
          ? "This draft was changed elsewhere, and you have edits that are not saved. Choose which version to continue with."
          : "Ticket creation started elsewhere, so this draft can no longer accept edits. Copy your edits before reloading; once creation finishes, you can apply them through Ticket details."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant="outline" onClick={onReload}>
          Reload saved draft
        </Button>
        {canKeepMine ? (
          <Button size="xs" onClick={onKeepMine}>
            Keep my edits
          </Button>
        ) : (
          <Button
            size="xs"
            onClick={() => {
              void writeTextToClipboard(JSON.stringify(fields, null, 2)).then(
                () => toastManager.add({ type: "success", title: "Draft edits copied" }),
                () => toastManager.add({ type: "error", title: "Could not copy draft edits" }),
              );
            }}
          >
            Copy my edits
          </Button>
        )}
      </div>
    </div>
  );
}

function DiscardDraftDialog({
  open,
  busy,
  creationUncertain,
  error,
  onOpenChange,
  onDiscard,
}: {
  readonly open: boolean;
  readonly busy: boolean;
  /** The draft is mid Create ticket, so a Jira issue may already exist for it. */
  readonly creationUncertain: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDiscard: () => Promise<boolean>;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this ticket draft?</AlertDialogTitle>
          <AlertDialogDescription>
            {creationUncertain
              ? "Creating this ticket did not finish, and Jira may already have created the issue. Discarding deletes the planning conversation and this draft here, but it does not delete anything in Jira. Check Jira for the issue before you create another ticket."
              : "The planning conversation and its draft are deleted. Tickets you already created are not affected."}
          </AlertDialogDescription>
          <WorkbenchInlineError message={error} />
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" disabled={busy} />}>
            Keep draft
          </AlertDialogClose>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              void onDiscard().then((discarded) => {
                if (discarded) onOpenChange(false);
              });
            }}
          >
            <Trash2Icon /> Discard draft
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

type DraftBodyProps = WorkbenchTicketConversationProps & {
  readonly draft: WorkbenchConversationDraft;
  readonly entries: ReturnType<typeof usePlanningModelSelection>["entries"];
  readonly onDraft: (draft: WorkbenchConversationDraft) => void;
  readonly beginFailure: string | null;
  readonly onRetryBegin: () => void;
};

/** True when the Thread runs on a provider that cannot enforce read-only planning. */
function useModelUnsupported({ environmentId, draft, entries }: DraftBodyProps) {
  const thread = useThreadShell(scopeThreadRef(environmentId, draft.threadId));
  const driver = entries.find(
    (entry) => entry.instanceId === thread?.providerInstanceId,
  )?.driverKind;
  return thread !== null && draft.phase !== "working" && !supportsEnforcedTicketPlanning(driver);
}

/** The assistant's newest proposal; Apply writes it into the fields as an explicit edit. */
/** The right-hand column: ticket fields or summary, errors, and the phase's actions. */
function WorkbenchDraftAside({
  props,
  editor,
  transitions,
  createState,
  canOperate,
  onDiscard,
}: {
  readonly props: DraftBodyProps;
  readonly editor: ReturnType<typeof useTicketDraftEditor>;
  readonly transitions: ReturnType<typeof useTicketDraftTransitions>;
  readonly createState: ReturnType<typeof getTicketDraftCreateState>;
  readonly canOperate: boolean;
  readonly onDiscard: () => void;
}) {
  const { draft, ticket, linkedProjects } = props;
  const { fields, edit } = editor;
  const modelUnsupported = useModelUnsupported(props);
  const planning = draft.phase === "planning" || draft.phase === "starting";
  return (
    <>
      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-4">
        {modelUnsupported ? <ModelUnsupportedNotice /> : null}
        {editor.conflict ? (
          <DraftConflictNotice
            onReload={editor.reload}
            onKeepMine={editor.keepMine}
            canKeepMine={editor.conflict.phase === "draft"}
            fields={editor.fields}
          />
        ) : null}
        {planning ? (
          <WorkbenchPlanningSummary
            summary={ticket ?? draft.fields}
            linkedProjects={linkedProjects}
          />
        ) : (
          <WorkbenchTicketDraftFieldsForm
            fields={fields}
            disabled={
              !editor.editable ||
              editor.conflict !== null ||
              transitions.action !== null ||
              !canOperate
            }
            linkedProjects={linkedProjects}
            epics={props.epics}
            jiraEpics={props.jiraEpics}
            jiraBinding={props.jiraBinding}
            localOnlySupported={props.localOnlySupported}
            jiraOwnershipKnown={props.jiraOwnershipKnown}
            onChange={edit}
            onCreateEpic={props.onCreateEpic}
          />
        )}
        <WorkbenchInlineError
          message={transitions.error ?? (editor.conflict ? null : editor.saveError)}
        />
      </div>
      <footer className="space-y-2 border-t border-border p-3">
        <DraftActions
          phase={draft.phase}
          action={transitions.action}
          canOperate={canOperate}
          blocker={editor.conflict ? DRAFT_CONFLICT_MESSAGE : createState.blocker}
          ticketExists={ticket !== null}
          createsInJira={createState.createsInJira}
          saveState={editor.saveState}
          onCreate={() => void transitions.promote(createState.effectiveFields)}
          onStartWork={() => void transitions.startWork()}
          onDiscard={onDiscard}
          onRetryDiscard={() => void transitions.discard()}
        />
      </footer>
    </>
  );
}

/** An unsaved draft offers manual entry; a saved planning ticket offers its details. */
function DraftHeaderAction({
  phase,
  hasTicket,
  onCreateManually,
  onShowTicketDetails,
}: {
  readonly phase: WorkbenchConversationDraft["phase"];
  readonly hasTicket: boolean;
  readonly onCreateManually: () => void;
  readonly onShowTicketDetails: () => void;
}) {
  if (phase === "draft") {
    return (
      <Button size="sm" variant="ghost" onClick={onCreateManually}>
        Create manually
      </Button>
    );
  }
  if (!hasTicket || (phase !== "planning" && phase !== "starting")) return null;
  return (
    <Button size="sm" variant="outline" onClick={onShowTicketDetails}>
      Ticket details
    </Button>
  );
}

function TicketConversationTabs({
  tab,
  planning,
  onTabChange,
}: {
  readonly tab: "conversation" | "draft";
  readonly planning: boolean;
  readonly onTabChange: (tab: "conversation" | "draft") => void;
}) {
  return (
    <ToggleGroup
      aria-label="Ticket conversation view"
      className="mx-3 mt-3 self-start @4xl/ticket-conversation:hidden"
      size="sm"
      value={[tab]}
      variant="segmented"
      onValueChange={(value) => {
        const next = value[0];
        if (next === "conversation" || next === "draft") onTabChange(next);
      }}
    >
      <Toggle value="conversation">Conversation</Toggle>
      <Toggle value="draft">{planning ? "Ticket" : "Draft"}</Toggle>
    </ToggleGroup>
  );
}

function WorkbenchTicketConversationBody(props: DraftBodyProps) {
  const { environmentId, draft, ticket, onDraft } = props;
  const [tab, setTab] = useState<"conversation" | "draft">("conversation");
  const [discardOpen, setDiscardOpen] = useState(false);
  const canOperate = useAtomValue(
    workbenchEnvironment.promoteTicketDraft.permissionAtom(environmentId),
  );
  const editor = useTicketDraftEditor({
    environmentId,
    draft,
    onDraft,
    refreshSnapshot: props.refreshSnapshot,
  });
  const blocker = useBlocker({
    withResolver: true,
    shouldBlockFn: async () => !(await editor.flush()).ok,
    enableBeforeUnload: () => editor.hasPendingEdits(),
  });
  const createState = getTicketDraftCreateState({
    fields: editor.fields,
    linkedProjects: props.linkedProjects,
    epics: props.epics,
    jiraEpics: props.jiraEpics,
    jiraBinding: props.jiraBinding,
    localOnlySupported: props.localOnlySupported,
    jiraOwnershipKnown: props.jiraOwnershipKnown,
  });
  const transitions = useTicketDraftTransitions({
    environmentId,
    draft,
    editor,
    onDraft,
    onTicketCreated: props.onTicketCreated,
    onWorkStarted: props.onWorkStarted,
    onDiscarded: props.onDiscarded,
    onClose: props.onClose,
    onCreateManually: props.onCreateManually,
    refreshSnapshot: props.refreshSnapshot,
  });
  const showTicketDetails = async () => {
    const outcome = await editor.flush();
    if (outcome.ok) props.onShowTicketDetails();
    else transitions.setError(outcome.message);
  };
  const phase = draft.phase;
  const planning = phase === "planning" || phase === "starting";
  const title = getConversationTitle(draft, ticket, editor.fields);
  return (
    <ConversationFrame
      title={title}
      badge={PHASE_LABELS[phase]}
      onClose={() => void transitions.close()}
      actions={
        <DraftHeaderAction
          phase={phase}
          hasTicket={ticket !== null}
          onCreateManually={() => void transitions.createManually()}
          onShowTicketDetails={() => void showTicketDetails()}
        />
      }
    >
      <div className="@container/ticket-conversation flex min-h-0 min-w-0 flex-1 flex-col">
        <TicketConversationTabs tab={tab} planning={planning} onTabChange={setTab} />
        <div className="flex min-h-0 min-w-0 flex-1 @4xl/ticket-conversation:grid @4xl/ticket-conversation:grid-cols-[minmax(0,1fr)_minmax(24rem,30rem)]">
          <section
            aria-label="Planning conversation"
            className={cn(
              "relative flex min-h-0 min-w-0 flex-1 flex-col",
              tab === "draft" && "@max-4xl/ticket-conversation:hidden",
            )}
          >
            {phase === "creating" ? (
              <BeginProgress
                failure={props.beginFailure}
                onRetry={props.onRetryBegin}
                onCreateManually={() => void transitions.createManually()}
              />
            ) : (
              <WorkbenchTicketProposalRenderer
                environmentId={environmentId}
                threadId={draft.threadId}
                linkedProjects={props.linkedProjects}
                fields={editor.fields}
                ticketCreated={ticket !== null}
                canApply={
                  canOperate &&
                  props.workspace.archivedAt == null &&
                  editor.editable &&
                  editor.conflict === null &&
                  transitions.action === null
                }
                onApply={(suggestion) => {
                  editor.edit({
                    title: suggestion.title,
                    markdown: suggestion.markdown,
                    repositoryProjectIds: [...suggestion.repositoryProjectIds],
                    primaryT3ProjectId: suggestion.primaryT3ProjectId,
                  });
                  void editor.flush();
                }}
              >
                <WorkbenchConversationPane
                  environmentId={environmentId}
                  threadId={draft.threadId}
                />
              </WorkbenchTicketProposalRenderer>
            )}
          </section>
          <aside
            aria-label={planning ? "Ticket" : "Ticket draft"}
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col border-border @4xl/ticket-conversation:border-l",
              tab === "conversation" && "@max-4xl/ticket-conversation:hidden",
            )}
          >
            <WorkbenchDraftAside
              props={props}
              editor={editor}
              transitions={transitions}
              createState={createState}
              canOperate={
                canOperate && props.workspace.archivedAt == null && ticket?.archivedAt == null
              }
              onDiscard={() => setDiscardOpen(true)}
            />
          </aside>
        </div>
      </div>
      <DiscardDraftDialog
        open={discardOpen}
        busy={transitions.action !== null}
        creationUncertain={phase === "promoting" && createState.createsInJira}
        error={transitions.error}
        onOpenChange={setDiscardOpen}
        onDiscard={transitions.discard}
      />
      <UnsavedDraftNavigationDialog
        open={blocker.status === "blocked"}
        onStay={() => blocker.reset?.()}
        onLeave={() => {
          editor.abandon();
          blocker.proceed?.();
        }}
      />
    </ConversationFrame>
  );
}

function getConversationTitle(
  draft: WorkbenchConversationDraft,
  ticket: WorkbenchTicket | null,
  fields: WorkbenchConversationDraft["fields"],
) {
  if (draft.phase === "planning" || draft.phase === "starting") {
    return ticket?.title ?? draft.fields.title;
  }
  return fields.title.trim() || "New ticket";
}

function UnsavedDraftNavigationDialog({
  open,
  onStay,
  onLeave,
}: {
  readonly open: boolean;
  readonly onStay: () => void;
  readonly onLeave: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onStay();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Your edits are not saved</AlertDialogTitle>
          <AlertDialogDescription>
            Saving failed. Stay to keep your edits here, or leave and discard the unsaved changes.
            The saved draft remains available.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={onStay}>
            Stay
          </Button>
          <Button variant="destructive" onClick={onLeave}>
            Leave without saving
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

interface DraftActionsProps {
  readonly phase: WorkbenchConversationDraft["phase"];
  readonly action: "promote" | "start" | "discard" | null;
  readonly canOperate: boolean;
  readonly blocker: string | null;
  /** The saved ticket exists, so only the ticket (not the draft) can still be changed. */
  readonly ticketExists: boolean;
  readonly createsInJira: boolean;
  readonly saveState: "idle" | "saving" | "saved" | "error";
  readonly onCreate: () => void;
  readonly onStartWork: () => void;
  readonly onDiscard: () => void;
  readonly onRetryDiscard: () => void;
}

const SPINNER = <LoaderCircleIcon className="animate-spin" aria-hidden />;

function PlanningActions({ phase, action, canOperate, onStartWork }: DraftActionsProps) {
  const label =
    action === "start"
      ? "Preparing work area…"
      : phase === "starting"
        ? "Retry start work"
        : "Start work";
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Start work prepares the work area and continues this conversation there. Nothing is sent
        automatically.
      </p>
      <Button className="w-full" disabled={action !== null || !canOperate} onClick={onStartWork}>
        {action === "start" ? SPINNER : <PlayIcon />}
        {label}
      </Button>
    </>
  );
}

function DiscardingActions({ action, canOperate, onRetryDiscard }: DraftActionsProps) {
  return (
    <Button className="w-full" disabled={action !== null || !canOperate} onClick={onRetryDiscard}>
      {action === "discard" ? SPINNER : <Trash2Icon />}
      {action === "discard" ? "Discarding…" : "Retry discard"}
    </Button>
  );
}

/** The blocker explains a disabled Create ticket; otherwise the line reports autosave. */
const getDraftStatusLine = ({
  action,
  blocker,
  createsInJira,
  phase,
  saveState,
  ticketExists,
}: Pick<
  DraftActionsProps,
  "action" | "blocker" | "createsInJira" | "phase" | "saveState" | "ticketExists"
>) => {
  if (phase === "promoting" && action === null && !blocker) {
    if (ticketExists)
      return "Linking the ticket to this conversation did not finish. Retry Create ticket.";
    return createsInJira
      ? "Creating the ticket did not finish. Retry Create ticket, or check Jira and discard the draft."
      : "Creating the ticket did not finish. Retry Create ticket, or discard the draft.";
  }
  if (blocker && phase !== "creating") return blocker;
  if (saveState === "saving") return "Saving…";
  return saveState === "saved" ? "Draft saved" : "\u00a0";
};

function UnsavedDraftActions({
  phase,
  action,
  canOperate,
  blocker,
  ticketExists,
  createsInJira,
  saveState,
  onCreate,
  onDiscard,
}: DraftActionsProps) {
  const busy = action !== null;
  const creating = action === "promote";
  const createLabel = creating
    ? createsInJira
      ? "Creating in Jira…"
      : "Creating ticket…"
    : "Create ticket";
  const status = getDraftStatusLine({
    action,
    blocker,
    createsInJira,
    phase,
    saveState,
    ticketExists,
  });
  return (
    <>
      <p role="status" className="text-xs text-muted-foreground">
        {status}
      </p>
      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !canDiscardConversationDraft({ phase, ticketExists }) || !canOperate}
          onClick={onDiscard}
        >
          <Trash2Icon /> Discard draft
        </Button>
        <Button
          disabled={busy || phase === "creating" || blocker !== null || !canOperate}
          aria-busy={creating}
          onClick={onCreate}
        >
          {creating ? SPINNER : <TicketPlusIcon />}
          {createLabel}
        </Button>
      </div>
    </>
  );
}

function DraftActions(props: DraftActionsProps) {
  if (props.phase === "planning" || props.phase === "starting")
    return <PlanningActions {...props} />;
  if (props.phase === "discarding") return <DiscardingActions {...props} />;
  return <UnsavedDraftActions {...props} />;
}
