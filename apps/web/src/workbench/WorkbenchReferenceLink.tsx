import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type {
  ScopedThreadRef,
  ThreadId,
  WorkbenchParsedReferenceUrl,
  WorkbenchReferenceKind,
} from "@t3tools/contracts";
import { projectScriptCwd } from "@t3tools/shared/projectScripts";
import { createContext, use, type MouseEvent, type ReactElement, type ReactNode } from "react";

import { canOpenLinksInApp } from "../browser/browserLinkTarget";
import { openFileInPreview } from "../browser/openFileInPreview";
import { useOpenLink } from "../browser/useOpenLink";
import { Badge } from "../components/ui/badge";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../components/ui/preview-card";
import { toastManager } from "../components/ui/toast";
import { useClientSettings } from "../hooks/useSettings";
import { useOpenChangeRequestLink } from "../lib/openPullRequestLink";
import { useRightPanelStore } from "../rightPanelStore";
import { assetEnvironment } from "../state/assets";
import { useProject, useQuietThreadShell } from "../state/entities";
import { previewEnvironment } from "../state/preview";
import { readPreparedConnection } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";
import { useOpenWorkbenchPullRequest } from "./WorkbenchPullRequestPreview";
import { WorkbenchReferenceKindIcon } from "./WorkbenchReferenceKindIcon";
import {
  WORKBENCH_REFERENCE_OPEN_TARGET_TEXT,
  workbenchReferenceOpenTarget,
  type WorkbenchReferenceOpenTarget,
} from "./workbenchReferences.logic";

export type OpenReferenceFileSheet = (file: {
  readonly parsed: WorkbenchParsedReferenceUrl;
  /** The Thread that added the file, whose host media reads it may need. */
  readonly threadId: ThreadId | null;
}) => void;

/** Set where a page can preview a host file without a Thread, such as the Ticket page. */
export const WorkbenchReferenceFileSheetContext = createContext<OpenReferenceFileSheet | null>(
  null,
);

export interface WorkbenchReferenceOpener {
  readonly targetOf: (reference: WorkbenchParsedReferenceUrl) => WorkbenchReferenceOpenTarget;
  readonly open: (
    event: MouseEvent<HTMLElement>,
    reference: WorkbenchParsedReferenceUrl,
    addedByThreadId?: ThreadId | null,
  ) => void;
}

/** Opens References beside the floating chat's Thread where the page can, per mockup 9. */
export function useWorkbenchReferenceOpener(): WorkbenchReferenceOpener {
  const shownThread = useWorkbenchFloatingChatStore((state) => state.shownThread) ?? undefined;
  const openWorkbenchPullRequest = useOpenWorkbenchPullRequest();
  const openChangeRequestLink = useOpenChangeRequestLink(
    shownThread,
    shownThread,
    openWorkbenchPullRequest,
  );
  const openLink = useOpenLink(shownThread);
  const shownThreadShell = useQuietThreadShell(shownThread ?? null);
  const shownProject = useProject(
    shownThreadShell
      ? scopeProjectRef(shownThreadShell.environmentId, shownThreadShell.projectId)
      : null,
  );
  // Like the Thread's own file links, so a workspace HTML page loads its relative assets.
  const workspaceRoot = shownProject
    ? projectScriptCwd({
        project: { cwd: shownProject.workspaceRoot },
        worktreePath: shownThreadShell?.worktreePath ?? null,
      })
    : undefined;
  const linksOpenInApp = useClientSettings((settings) => settings.browserLinkTarget) === "app";
  const openFileSheet = use(WorkbenchReferenceFileSheetContext);
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, { reportFailure: false });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const targetOf = (reference: WorkbenchParsedReferenceUrl) =>
    workbenchReferenceOpenTarget(reference, {
      hasThread: shownThread !== undefined,
      canOpenInApp: canOpenLinksInApp(shownThread),
      linksOpenInApp,
      hasFileSheet: openFileSheet !== null,
    });
  const openInSidePanel = (thread: ScopedThreadRef, path: string) =>
    useRightPanelStore.getState().openFile(thread, path);
  const openInBrowserPanel = (
    thread: ScopedThreadRef,
    event: MouseEvent<HTMLElement>,
    reference: WorkbenchParsedReferenceUrl,
  ) => {
    if (reference.kind !== "file") {
      void openLink(reference.url, { event }).catch((error: unknown) =>
        toastManager.add({
          type: "error",
          title: "Unable to open link",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
      return;
    }
    const connection = readPreparedConnection(thread.environmentId);
    if (connection === null) {
      openInSidePanel(thread, reference.url);
      return;
    }
    // The file panel previews HTML and PDF too, so it stands in when the browser can't open one.
    void openFileInPreview({
      threadRef: thread,
      filePath: reference.url,
      workspaceRoot,
      httpBaseUrl: connection.httpBaseUrl,
      createAssetUrl,
      openPreview,
    }).then((result) => {
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        openInSidePanel(thread, reference.url);
      }
    });
  };
  return {
    targetOf,
    open: (event, reference, addedByThreadId = null) => {
      const target = targetOf(reference);
      if (target === "pull_request_panel" || target === "pull_request_sheet") {
        // Without the page's preview the native handler would leave the page for PR review.
        if (openWorkbenchPullRequest) openChangeRequestLink(event, reference.url);
        return;
      }
      // The link's own new tab is the system browser.
      if (target === "system_browser") return;
      event.preventDefault();
      if (target === "file_sheet")
        openFileSheet?.({ parsed: reference, threadId: addedByThreadId });
      else if (shownThread === undefined || target === "none") return;
      else if (target === "file_panel") openInSidePanel(shownThread, reference.url);
      else openInBrowserPanel(shownThread, event, reference);
    },
  };
}

const KIND_LABELS = {
  jira_issue: "Jira issue",
  github_issue: "GitHub issue",
  github_pull_request: "GitHub pull request",
  file: "File",
  link: "Link",
} satisfies Record<WorkbenchReferenceKind, string>;

// Legacy References whose URL no longer parses show as links with no host.
const kindLabel = (reference: WorkbenchParsedReferenceUrl) =>
  reference.kind === "file" || reference.kind === "jira_issue" || !URL.canParse(reference.url)
    ? KIND_LABELS[reference.kind]
    : `${KIND_LABELS[reference.kind]} · ${new URL(reference.url).host}`;

/** A Reference's kind, name, full URL or path, and a closing note, such as where it opens. */
export function WorkbenchReferenceHoverCard({
  reference,
  title,
  source,
  note,
  trigger,
}: {
  readonly reference: WorkbenchParsedReferenceUrl;
  readonly title: string;
  /** Where the Reference comes from, such as "from the description". */
  readonly source?: string | undefined;
  readonly note: ReactNode;
  readonly trigger: ReactElement;
}) {
  return (
    <PreviewCard>
      <PreviewCardTrigger render={trigger} delay={350} closeDelay={120} />
      <PreviewCardPopup className="w-80 max-w-[calc(100vw-2rem)]">
        <div className="min-w-0 space-y-1 p-3">
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <WorkbenchReferenceKindIcon
              kind={reference.kind}
              url={reference.url}
              className="size-3.5 shrink-0"
            />
            <span className="min-w-0 truncate">
              {kindLabel(reference)}
              {source === undefined ? null : ` · ${source}`}
            </span>
          </p>
          <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">{title}</p>
          <p className="break-all font-mono text-xs text-muted-foreground">{reference.url}</p>
        </div>
        <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">{note}</p>
      </PreviewCardPopup>
    </PreviewCard>
  );
}

/** Where a click on `reference` opens, for its hover card. */
export const workbenchReferenceOpenNote = (
  opener: WorkbenchReferenceOpener,
  reference: WorkbenchParsedReferenceUrl,
) => WORKBENCH_REFERENCE_OPEN_TARGET_TEXT[opener.targetOf(reference)];

/** The element a Reference opens through: a file has no URL a browser can open. */
export function workbenchReferenceTarget({
  reference,
  opener,
  addedByThreadId,
  ...props
}: {
  readonly reference: WorkbenchParsedReferenceUrl;
  readonly opener: WorkbenchReferenceOpener;
  readonly addedByThreadId?: ThreadId | null;
  readonly className?: string;
  readonly children?: ReactNode;
}): ReactElement {
  const onClick = (event: MouseEvent<HTMLElement>) =>
    opener.open(event, reference, addedByThreadId);
  return reference.kind === "file" ? (
    <button type="button" {...props} onClick={onClick} />
  ) : (
    <a
      href={reference.url}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
      onClick={onClick}
    />
  );
}

/** A description link as a chip: kind icon and short name, with details on hover. */
export function WorkbenchReferenceChip({
  reference,
  title,
  opener,
}: {
  readonly reference: WorkbenchParsedReferenceUrl;
  readonly title: string | null;
  readonly opener: WorkbenchReferenceOpener;
}) {
  const name = title ?? reference.label;
  return (
    <WorkbenchReferenceHoverCard
      reference={reference}
      title={name}
      note={workbenchReferenceOpenNote(opener, reference)}
      trigger={
        <Badge
          variant="outline"
          className="max-w-full align-middle"
          render={workbenchReferenceTarget({ reference, opener })}
        >
          <WorkbenchReferenceKindIcon kind={reference.kind} url={reference.url} />
          <span className="truncate">{name}</span>
        </Badge>
      }
    />
  );
}
