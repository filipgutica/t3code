import type {
  EnvironmentId,
  WorkbenchReviewBase,
  WorkbenchTicket,
  WorkbenchTicketDraft,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { descriptionUsesJiraMarkup } from "./workbenchDescriptionEditor.logic";
import { useMarkdownAskForChange, type MarkdownAskRequest } from "./useMarkdownAskForChange";
import { useMarkdownReview, type MarkdownReviewOutcome } from "./useMarkdownReview";
import { failureCode, failureMessage } from "./workbenchPageCommands";

const UNDO_CONFLICT =
  "An agent changed the brief after you opened this review. The diff now includes its edit; Undo again to restore the text from before both.";

type Result = AtomCommandResult<unknown, unknown>;

const reviewOutcome = (result: Result, action: "accept" | "undo"): MarkdownReviewOutcome => {
  if (result._tag === "Success") return { kind: "done" };
  const code = failureCode(result);
  return action === "undo" && (code === "ticket_changed" || code === "ticket_draft_changed")
    ? { kind: "conflict", message: UNDO_CONFLICT }
    : { kind: "failed", message: failureMessage(result) };
};

/**
 * The review and Ask for change of a Ticket's or draft's title and brief. The commands name the
 * revision the person is looking at, so a newer edit fails them instead of being overwritten.
 */
export function useWorkbenchBriefReview({
  title,
  markdown,
  reviewBase,
  reviewable,
  askable,
  accept,
  undo,
  ask,
}: {
  readonly title: string;
  readonly markdown: string;
  readonly reviewBase: WorkbenchReviewBase | null | undefined;
  /** False while a local edit is shown, which the base and revision do not describe. */
  readonly reviewable: boolean;
  /** False where rendered offsets would not match the saved text, such as Jira wiki markup. */
  readonly askable: boolean;
  readonly accept: () => Promise<Result>;
  readonly undo: () => Promise<Result>;
  readonly ask: (request: MarkdownAskRequest) => Promise<Result>;
}) {
  const review = useMarkdownReview({
    base: reviewable ? (reviewBase ?? null) : null,
    title,
    markdown,
    onAccept: async () => reviewOutcome(await accept(), "accept"),
    onUndo: async () => reviewOutcome(await undo(), "undo"),
  });
  const askForChange = useMarkdownAskForChange({
    markdown,
    enabled: reviewable && askable,
    onAsk: async (request) => {
      const result = await ask(request);
      return result._tag === "Success" || isAtomCommandInterrupted(result)
        ? null
        : failureMessage(result);
    },
  });
  return { ...review, askForChange };
}

/**
 * A Ticket page's brief review. A local edit, even one saved but not yet in the snapshot, is not
 * the text the review describes, so `localEdit` hides it; Jira wiki markup renders as other text.
 */
export function useWorkbenchTicketBriefReview({
  environmentId,
  ticket,
  localEdit,
  archived,
  jira,
}: {
  readonly environmentId: EnvironmentId;
  readonly ticket: WorkbenchTicket;
  readonly localEdit: boolean;
  readonly archived: boolean;
  readonly jira: boolean;
}) {
  const options = { reportFailure: false };
  const accept = useAtomCommand(workbenchEnvironment.acceptTicketReview, options);
  const undo = useAtomCommand(workbenchEnvironment.undoTicketReview, options);
  const ask = useAtomCommand(workbenchEnvironment.askForTicketChange, options);
  const target = { id: ticket.id, expectedRevision: ticket.revision };
  const briefReview = useWorkbenchBriefReview({
    title: ticket.title,
    markdown: ticket.markdown,
    reviewBase: ticket.reviewBase,
    reviewable: !localEdit && !archived,
    askable: !descriptionUsesJiraMarkup(ticket.markdown, jira),
    accept: () => accept({ environmentId, input: target }),
    undo: () => undo({ environmentId, input: target }),
    ask: (request) => ask({ environmentId, input: { ...target, ...request } }),
  });
  const { review } = briefReview;
  return {
    ...briefReview,
    /** The title's word diff for the page header while the diff shows. */
    shownTitleWords: review?.diffShown ? review.titleWords : null,
  };
}

/** A conversation draft's brief review; `revision` is the saved revision its fields show. */
export function useWorkbenchDraftBriefReview({
  environmentId,
  draft,
  revision,
  reviewable,
  onDraft,
}: {
  readonly environmentId: EnvironmentId;
  readonly draft: WorkbenchTicketDraft;
  readonly revision: () => number;
  readonly reviewable: boolean;
  readonly onDraft: (draft: WorkbenchTicketDraft) => void;
}) {
  const options = { reportFailure: false };
  const accept = useAtomCommand(workbenchEnvironment.acceptTicketDraftReview, options);
  const undo = useAtomCommand(workbenchEnvironment.undoTicketDraftReview, options);
  const ask = useAtomCommand(workbenchEnvironment.askForTicketDraftChange, options);
  const settle = (result: AtomCommandResult<WorkbenchTicketDraft, unknown>) => {
    if (result._tag === "Success") onDraft(result.value);
    return result;
  };
  const target = () => ({ id: draft.id, expectedRevision: revision() });
  return useWorkbenchBriefReview({
    title: draft.fields.title,
    markdown: draft.fields.markdown,
    reviewBase: draft.reviewBase,
    reviewable,
    // The draft card renders its brief without Jira markup.
    askable: true,
    accept: async () => settle(await accept({ environmentId, input: target() })),
    undo: async () => settle(await undo({ environmentId, input: target() })),
    ask: async (request) =>
      settle(await ask({ environmentId, input: { ...target(), ...request } })),
  });
}
