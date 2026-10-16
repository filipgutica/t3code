import type { EnvironmentId, WorkbenchProjectId, WorkbenchTicketId } from "@t3tools/contracts";
import { ChevronRightIcon, FilePenLineIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../components/ui/collapsible";
import { SidebarMenu, SidebarMenuItem } from "../components/ui/sidebar";
import { WorkbenchSidebarRowNavigation } from "./WorkbenchSidebarRowNavigation";
import { WorkbenchSidebarRowActions } from "./WorkbenchSidebarRowActions";
import { toastManager } from "../components/ui/toast";
import { readLocalApi } from "../localApi";
import { useWorkbenchDraftActions } from "./useWorkbenchDraftActions";
import type { WorkbenchConversationDraft } from "./workbenchTicketDraft.logic";

export type WorkbenchSidebarDraft = WorkbenchConversationDraft & { readonly title: string };

type DraftMenuRequest = {
  readonly draftId: WorkbenchTicketId;
  readonly trigger: HTMLElement;
  readonly workspaceButton: HTMLElement | null;
  readonly position: { x: number; y: number };
};

const visible = (element: HTMLElement | null | undefined) =>
  element?.isConnected && element.getClientRects().length > 0 ? element : null;

function useWorkbenchSidebarDraftDisclosure(selectedDraft: WorkbenchSidebarDraft | undefined) {
  const selectedDraftId = selectedDraft?.id;
  const [disclosure, setDisclosure] = useState({
    selectedDraftId,
    collapsed: new Set<WorkbenchProjectId>(),
  });
  if (disclosure.selectedDraftId !== selectedDraftId) {
    const collapsed = new Set(disclosure.collapsed);
    if (selectedDraft) collapsed.delete(selectedDraft.projectId);
    setDisclosure({ selectedDraftId, collapsed });
  }
  return {
    collapsed: disclosure.collapsed,
    reveal: (workspaceId: WorkbenchProjectId) =>
      setDisclosure((previous) => {
        if (!previous.collapsed.has(workspaceId)) return previous;
        const collapsed = new Set(previous.collapsed);
        collapsed.delete(workspaceId);
        return { ...previous, collapsed };
      }),
    toggle: (workspaceId: WorkbenchProjectId) =>
      setDisclosure((previous) => {
        const collapsed = new Set(previous.collapsed);
        if (collapsed.has(workspaceId)) collapsed.delete(workspaceId);
        else collapsed.add(workspaceId);
        return { ...previous, collapsed };
      }),
  };
}

const closeMenu = () => {
  void readLocalApi()
    ?.contextMenu.close()
    .catch((cause: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not close draft actions",
        description:
          cause instanceof Error ? cause.message : "Please close the menu and try again.",
      });
    });
};

export function useWorkbenchSidebarDrafts(
  input: Omit<Parameters<typeof useWorkbenchSidebarDraftMenu>[0], "navigationRef"> & {
    readonly selectedDraft: WorkbenchSidebarDraft | undefined;
  },
) {
  const navigationRef = useRef<HTMLDivElement>(null);
  const disclosure = useWorkbenchSidebarDraftDisclosure(input.selectedDraft);
  const menu = useWorkbenchSidebarDraftMenu({ ...input, navigationRef });
  return { navigationRef, disclosure, menu };
}

/** The owner stays above filtered workspace rows so deletion can remove its trigger safely. */
export function useWorkbenchSidebarDraftMenu({
  environmentId,
  drafts,
  writableWorkspaceIds,
  selectedWorkspaceId,
  selectedTicketId,
  onSelectWorkspace,
  navigationRef,
}: {
  readonly environmentId: EnvironmentId;
  readonly drafts: ReadonlyArray<WorkbenchSidebarDraft>;
  readonly writableWorkspaceIds: ReadonlySet<WorkbenchProjectId>;
  readonly selectedWorkspaceId: WorkbenchProjectId | undefined;
  readonly selectedTicketId: WorkbenchTicketId | undefined;
  readonly onSelectWorkspace: (id: WorkbenchProjectId) => void;
  readonly navigationRef: RefObject<HTMLElement | null>;
}) {
  const [confirmedDraft, setConfirmedDraft] = useState<WorkbenchSidebarDraft | null>(null);
  const readOnlyDraftIds = new Set(
    drafts.filter((draft) => !writableWorkspaceIds.has(draft.projectId)).map((draft) => draft.id),
  );
  if (confirmedDraft && !writableWorkspaceIds.has(confirmedDraft.projectId))
    readOnlyDraftIds.add(confirmedDraft.id);
  const actions = useWorkbenchDraftActions({ environmentId, drafts, readOnlyDraftIds });
  const latest = useRef<{ actions: typeof actions; drafts: typeof drafts } | null>({
    actions,
    drafts,
  });
  const pendingMenu = useRef<{ draftId: WorkbenchTicketId; sequence: number } | null>(null);
  const sequence = useRef(0);
  const returnFocus = useRef<DraftMenuRequest | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const handled = useRef<typeof actions.confirmation>(null);

  useLayoutEffect(() => {
    latest.current = { actions, drafts };
    const pending = pendingMenu.current;
    const target = pending && drafts.find((draft) => draft.id === pending.draftId);
    if (pending && (!target || !actions.canMutate || !actions.canDiscard(target))) {
      pendingMenu.current = null;
      sequence.current++;
      closeMenu();
    }
  });
  useLayoutEffect(
    () => () => {
      latest.current = null;
      sequence.current++;
      if (pendingMenu.current) {
        pendingMenu.current = null;
        closeMenu();
      }
    },
    [],
  );
  useEffect(() => {
    const confirmation = actions.confirmation;
    if (!actions.discardSucceeded || !confirmation || handled.current === confirmation) return;
    handled.current = confirmation;
    const discarded = confirmation.drafts.find((draft) => draft.id === selectedTicketId);
    if (discarded && discarded.projectId === selectedWorkspaceId)
      onSelectWorkspace(discarded.projectId);
  }, [
    actions.confirmation,
    actions.discardSucceeded,
    selectedTicketId,
    selectedWorkspaceId,
    onSelectWorkspace,
  ]);

  const openMenu = async (request: DraftMenuRequest) => {
    const api = readLocalApi();
    const draft = drafts.find((candidate) => candidate.id === request.draftId);
    if (!api || !draft) return;
    const currentSequence = ++sequence.current;
    pendingMenu.current = { draftId: draft.id, sequence: currentSequence };
    setMenuError(null);
    try {
      const selected = await api.contextMenu.show(
        [
          {
            id: "discard",
            label: "Discard draft",
            destructive: true,
            icon: "trash",
            disabled: actions.busy || !actions.canMutate || !actions.canDiscard(draft),
          },
        ],
        request.position,
      );
      if (selected !== "discard" || currentSequence !== sequence.current || !latest.current) return;
      const target = latest.current.drafts.find((candidate) => candidate.id === request.draftId);
      if (!target) return;
      returnFocus.current = request;
      setConfirmedDraft(target);
      latest.current.actions.confirm([target]);
    } catch (cause) {
      if (currentSequence === sequence.current && latest.current)
        setMenuError(
          `Could not open draft actions. ${cause instanceof Error ? cause.message : "Please try again."}`,
        );
    } finally {
      if (pendingMenu.current?.sequence === currentSequence) pendingMenu.current = null;
    }
  };
  return {
    actions,
    confirmationTitle: confirmedDraft?.title ?? "",
    creationUncertain: Boolean(
      actions.confirmation?.drafts.some((draft) => draft.phase === "promoting"),
    ),
    openMenu,
    error: actions.error ?? menuError,
    finalFocus: () => {
      const request = returnFocus.current;
      return (
        (!actions.discardSucceeded && visible(request?.trigger)) ||
        visible(request?.workspaceButton) ||
        visible(
          navigationRef.current?.querySelector<HTMLInputElement>(
            'input[aria-label="Search Workbench sidebar"]',
          ),
        ) ||
        visible(navigationRef.current) ||
        visible(document.querySelector<HTMLElement>('[aria-label="Ticket board"]'))
      );
    },
  };
}

export function WorkbenchSidebarDrafts({
  drafts,
  workspaceTitle,
  workspaceButtonRef,
  selectedTicketId,
  expanded,
  isSearching,
  onToggle,
  onSelect,
  onOpenMenu,
}: {
  readonly drafts: ReadonlyArray<WorkbenchSidebarDraft>;
  readonly workspaceTitle: string;
  readonly workspaceButtonRef: RefObject<HTMLButtonElement | null>;
  readonly selectedTicketId: WorkbenchTicketId | undefined;
  readonly expanded: boolean;
  readonly isSearching: boolean;
  readonly onToggle: () => void;
  readonly onSelect: (draft: WorkbenchSidebarDraft) => void;
  readonly onOpenMenu: (request: DraftMenuRequest) => Promise<void>;
}) {
  if (drafts.length === 0) return null;
  const openAt = (
    draft: WorkbenchSidebarDraft,
    trigger: HTMLElement,
    position?: { x: number; y: number },
  ) => {
    const bounds = trigger.getBoundingClientRect();
    void onOpenMenu({
      draftId: draft.id,
      trigger,
      workspaceButton: workspaceButtonRef.current,
      position: position ?? { x: bounds.left, y: bounds.bottom },
    });
  };
  return (
    <Collapsible open={expanded || isSearching} onOpenChange={onToggle} className="mb-1">
      <CollapsibleTrigger
        disabled={isSearching}
        aria-label={`${expanded || isSearching ? "Collapse" : "Expand"} drafts in ${workspaceTitle}`}
        data-workbench-sidebar-group-toggle=""
        className="group"
      >
        <ChevronRightIcon aria-hidden className="size-3 shrink-0 group-data-panel-open:rotate-90" />
        <span>Drafts</span>
        <span className="tabular-nums">{drafts.length}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel animate={false}>
        <div data-workbench-sidebar-draft-list="">
          <SidebarMenu>
            {drafts.map((draft) => (
              <SidebarMenuItem key={draft.id}>
                <div
                  data-workbench-sidebar-item-row="compact"
                  data-workbench-sidebar-surface=""
                  data-active={draft.id === selectedTicketId || undefined}
                  className="relative"
                >
                  <WorkbenchSidebarRowNavigation
                    label={`Open draft ${draft.title}`}
                    isActive={draft.id === selectedTicketId}
                    compact
                    onSelect={() => onSelect(draft)}
                    openMenu={(position, trigger) => openAt(draft, trigger, position)}
                    preview={<span className="p-2">{draft.title}</span>}
                  >
                    <FilePenLineIcon aria-hidden className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{draft.title}</span>
                  </WorkbenchSidebarRowNavigation>
                  <WorkbenchSidebarRowActions
                    label={`Actions for draft ${draft.title}`}
                    openMenu={(position, trigger) => openAt(draft, trigger, position)}
                  />
                </div>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
