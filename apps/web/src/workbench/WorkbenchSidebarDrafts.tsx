import type { EnvironmentId, WorkbenchProjectId, WorkbenchTicketId } from "@t3tools/contracts";
import { ChevronRightIcon, EllipsisIcon, FilePenLineIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../components/ui/collapsible";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";
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
    <Collapsible open={expanded || isSearching} onOpenChange={onToggle} className="mb-2">
      <CollapsibleTrigger
        disabled={isSearching}
        aria-label={`${expanded || isSearching ? "Collapse" : "Expand"} drafts in ${workspaceTitle}`}
        className="group flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronRightIcon aria-hidden className="size-3 shrink-0 group-data-panel-open:rotate-90" />
        <span>Drafts</span>
        <span className="ml-auto tabular-nums">{drafts.length}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel animate={false}>
        <div className="ms-3 border-l border-sidebar-border ps-2">
          <SidebarMenu>
            {drafts.map((draft) => (
              <SidebarMenuItem key={draft.id}>
                <div
                  data-workbench-sidebar-item-row=""
                  className={`group/draft relative flex min-w-0 rounded-lg ${draft.id === selectedTicketId ? "bg-sidebar-row-selected" : "hover:bg-sidebar-row-hover"}`}
                >
                  <SidebarMenuButton
                    aria-label={`Open draft ${draft.title}`}
                    aria-current={draft.id === selectedTicketId ? "page" : undefined}
                    isActive={draft.id === selectedTicketId}
                    onClick={() => onSelect(draft)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openAt(draft, event.currentTarget, { x: event.clientX, y: event.clientY });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                        event.preventDefault();
                        openAt(draft, event.currentTarget);
                      }
                    }}
                    tooltip={{ children: draft.title, hidden: false }}
                    className="min-h-11 min-w-0 flex-1 sm:min-h-9"
                  >
                    <FilePenLineIcon aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{draft.title}</span>
                  </SidebarMenuButton>
                  <button
                    type="button"
                    aria-label={`Actions for draft ${draft.title}`}
                    aria-haspopup="menu"
                    onClick={(event) => openAt(draft, event.currentTarget)}
                    className="flex w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-ring sm:w-8 sm:opacity-0 sm:group-focus-within/draft:opacity-100 sm:group-hover/draft:opacity-100"
                  >
                    <EllipsisIcon aria-hidden className="size-4" />
                  </button>
                </div>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
