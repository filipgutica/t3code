import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
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

import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { descriptionUsesJiraMarkup } from "./workbenchDescriptionEditor.logic";
import { useMarkdownAskForChange, type MarkdownAskRequest } from "./useMarkdownAskForChange";
import { useMarkdownReview, type MarkdownReviewOutcome } from "./useMarkdownReview";
import { failureCode, failureMessage } from "./workbenchPageCommands";

const UNDO_CONFLICT =
  "An agent changed the brief after you opened this review. The diff now includes its edit; Undo again to restore the text from before both.";

type Result = AtomCommandResult<unknown, unknown>;

/** Which of the review's commands this connection may run; a read-only one still sees the diff. */
type BriefReviewPermissions = {
  readonly ask: boolean;
  readonly accept: boolean;
  readonly undo: boolean;
};

const reviewOutcome = (result: Result, action: "accept" | "undo"): MarkdownReviewOutcome => {
  if (result._tag === "Success") return { kind: "done" };
  const code = failureCode(result);
  return action === "undo" && (code === "ticket_changed" || code === "ticket_draft_changed")
    ? { kind: "conflict", message: UNDO_CONFLICT }
    : { kind: "failed", message: failureMessage(result) };
};

/** The last accepted change: whether there is one, whether it is shown, and its base once loaded. */
type AcceptedChange = {
  readonly available: boolean;
  readonly shown: boolean;
  readonly base: WorkbenchReviewBase | null;
  readonly toggle: () => void;
};

/** Shows an accepted change for the revision it was asked on; a newer revision hides it. */
const useAcceptedToggle = (revision: number) => {
  const [shownFor, setShownFor] = useState<number | null>(null);
  const shown = shownFor === revision;
  return { shown, toggle: () => setShownFor(shown ? null : revision) };
};

/**
 * The review and Ask for change of a Ticket's or draft's title and brief. The commands name the
 * revision the person is looking at, so a newer edit fails them instead of being overwritten.
 * With nothing pending, the badge shows the last accepted change, read-only.
 */
export function useWorkbenchBriefReview({
  title,
  markdown,
  reviewBase,
  accepted,
  reviewable,
  askable,
  permitted,
  accept,
  undo,
  ask,
}: {
  readonly title: string;
  readonly markdown: string;
  readonly reviewBase: WorkbenchReviewBase | null | undefined;
  readonly accepted: AcceptedChange;
  /** False while a local edit is shown, which the base and revision do not describe. */
  readonly reviewable: boolean;
  /** False where rendered offsets would not match the saved text, such as Jira wiki markup. */
  readonly askable: boolean;
  readonly permitted: BriefReviewPermissions;
  readonly accept: () => Promise<Result>;
  readonly undo: () => Promise<Result>;
  readonly ask: (request: MarkdownAskRequest) => Promise<Result>;
}) {
  const pending = reviewable ? (reviewBase ?? null) : null;
  const acceptedShown = pending === null && reviewable && accepted.available && accepted.shown;
  const review = useMarkdownReview({
    base: pending ?? (acceptedShown ? accepted.base : null),
    title,
    markdown,
    onAccept: async () => reviewOutcome(await accept(), "accept"),
    onUndo: async () => reviewOutcome(await undo(), "undo"),
    onHideAccepted: pending === null ? accepted.toggle : undefined,
  });
  const askForChange = useMarkdownAskForChange({
    markdown,
    enabled: reviewable && askable && permitted.ask,
    onAsk: async (request) => {
      const result = await ask(request);
      return result._tag === "Success" || isAtomCommandInterrupted(result)
        ? null
        : failureMessage(result);
    },
  });
  const toggleAccepted = pending === null && reviewable && accepted.available;
  return {
    ...review,
    // Pressed while an accepted change loads, so a second click cancels it.
    diffShown: review.diffShown || acceptedShown,
    /** The badge's click: the pending diff, or the accepted change while nothing is pending. */
    toggleDiff: review.review?.toggleDiff ?? (toggleAccepted ? accepted.toggle : undefined),
    askForChange,
    permitted,
  };
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
  const permitted = {
    ask: useAtomValue(workbenchEnvironment.askForTicketChange.permissionAtom(environmentId)),
    accept: useAtomValue(workbenchEnvironment.acceptTicketReview.permissionAtom(environmentId)),
    undo: useAtomValue(workbenchEnvironment.undoTicketReview.permissionAtom(environmentId)),
  };
  const target = { id: ticket.id, expectedRevision: ticket.revision };
  const reviewable = !localEdit && !archived;
  const acceptedToggle = useAcceptedToggle(ticket.revision);
  // Snapshots carry only the flag; the base loads when the person asks to see it.
  const acceptedRead = useEnvironmentQuery(
    reviewable && ticket.acceptedChange === true && acceptedToggle.shown
      ? workbenchEnvironment.ticket({
          environmentId,
          input: { ticketId: ticket.id, revision: ticket.revision },
        })
      : null,
  );
  const briefReview = useWorkbenchBriefReview({
    title: ticket.title,
    markdown: ticket.markdown,
    reviewBase: ticket.reviewBase,
    accepted: {
      available: ticket.acceptedChange === true,
      ...acceptedToggle,
      base:
        acceptedRead.data?.revision === ticket.revision
          ? (acceptedRead.data.acceptedBase ?? null)
          : null,
    },
    reviewable,
    askable: !descriptionUsesJiraMarkup(ticket.markdown, jira),
    permitted,
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
  const permitted = {
    ask: useAtomValue(workbenchEnvironment.askForTicketDraftChange.permissionAtom(environmentId)),
    accept: useAtomValue(
      workbenchEnvironment.acceptTicketDraftReview.permissionAtom(environmentId),
    ),
    undo: useAtomValue(workbenchEnvironment.undoTicketDraftReview.permissionAtom(environmentId)),
  };
  const settle = (result: AtomCommandResult<WorkbenchTicketDraft, unknown>) => {
    if (result._tag === "Success") onDraft(result.value);
    return result;
  };
  const target = () => ({ id: draft.id, expectedRevision: revision() });
  const acceptedToggle = useAcceptedToggle(draft.revision);
  return useWorkbenchBriefReview({
    title: draft.fields.title,
    markdown: draft.fields.markdown,
    reviewBase: draft.reviewBase,
    accepted: {
      available: draft.acceptedBase != null,
      ...acceptedToggle,
      base: draft.acceptedBase ?? null,
    },
    reviewable,
    // The draft card renders its brief without Jira markup.
    askable: true,
    permitted,
    accept: async () => settle(await accept({ environmentId, input: target() })),
    undo: async () => settle(await undo({ environmentId, input: target() })),
    ask: async (request) =>
      settle(await ask({ environmentId, input: { ...target(), ...request } })),
  });
}
