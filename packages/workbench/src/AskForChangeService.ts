import {
  WorkbenchOperationError,
  WorkbenchTicket,
  type ProjectId,
  type WorkbenchAskForChangeInput,
  type WorkbenchTicketDraft,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { MarkdownRewriteHost } from "./MarkdownRewriteHost.ts";
import { rewriteMarkdownBlocks } from "./markdownBlockRewrite.ts";
import { WorkbenchStore } from "./WorkbenchStore.ts";

/**
 * Rewrites selected brief blocks with the environment's text generation model
 * and writes them as an Ask for change edit awaiting review. No Thread starts.
 */
export class AskForChangeService extends Context.Service<
  AskForChangeService,
  {
    readonly askForTicketChange: (
      input: WorkbenchAskForChangeInput,
    ) => Effect.Effect<WorkbenchTicket, WorkbenchOperationError>;
    readonly askForDraftChange: (
      input: WorkbenchAskForChangeInput,
    ) => Effect.Effect<WorkbenchTicketDraft, WorkbenchOperationError>;
  }
>()("@t3tools/workbench/AskForChangeService") {}

const CHANGED_WHILE_REWRITING = "The brief changed while rewriting. Ask again.";
const isBrief = Schema.is(WorkbenchTicket.fields.markdown);

/** The title and the first paragraph, which usually states the goal. */
const briefContext = ({ title, markdown }: { readonly title: string; readonly markdown: string }) =>
  [
    title,
    markdown
      .split(/\n\s*\n/u)
      .map((block) => block.trim())
      .find((block) => block !== "" && !block.startsWith("#")) ?? "",
  ]
    .filter((part) => part !== "")
    .join("\n\n");

/** The stale-revision error of the final write means someone wrote during generation. */
const staleAsChangedWhileRewriting =
  (code: "ticket_changed" | "ticket_draft_changed") =>
  <A, R>(write: Effect.Effect<A, WorkbenchOperationError, R>) =>
    write.pipe(
      Effect.catchTags({
        WorkbenchOperationError: (error) =>
          Effect.fail(
            error.code === code
              ? new WorkbenchOperationError({ code, message: CHANGED_WHILE_REWRITING })
              : error,
          ),
      }),
    );

const make = Effect.gen(function* () {
  const store = yield* WorkbenchStore;
  const host = yield* MarkdownRewriteHost;

  // Generation runs on the request fiber outside any transaction: it holds no
  // SQLite writer, and interrupting the request ends it before anything is written.
  const rewrite = (
    input: WorkbenchAskForChangeInput,
    brief: { readonly projectId: ProjectId; readonly title: string; readonly markdown: string },
  ) =>
    rewriteMarkdownBlocks({
      projectId: brief.projectId,
      markdown: brief.markdown,
      start: input.start,
      end: input.end,
      blockSource: input.blockSource,
      selectedText: input.selectedText,
      instruction: input.instruction,
      context: briefContext(brief),
    }).pipe(
      Effect.provideService(MarkdownRewriteHost, host),
      Effect.filterOrFail(
        isBrief,
        () =>
          new WorkbenchOperationError({
            code: "ask_for_change_failed",
            message: "The rewritten brief is too long. Ask for a shorter change.",
          }),
      ),
    );

  const askForTicketChange = Effect.fn("AskForChangeService.askForTicketChange")(function* (
    input: WorkbenchAskForChangeInput,
  ) {
    const ticket = yield* store.getTicket(input.id);
    if (Option.isNone(ticket)) {
      return yield* new WorkbenchOperationError({
        code: "ticket_not_found",
        message: "The Workbench Ticket does not exist.",
      });
    }
    if (ticket.value.revision !== input.expectedRevision) {
      return yield* new WorkbenchOperationError({
        code: "ticket_changed",
        message: "The brief changed. Review it and ask again.",
      });
    }
    if (ticket.value.archivedAt != null) {
      return yield* new WorkbenchOperationError({
        code: "ticket_archived",
        message: "Archived Workbench Tickets cannot be modified.",
      });
    }
    // As for the generated summary, the first repository's settings and checkout run it.
    const projectId = ticket.value.repositoryProjectIds[0];
    if (projectId === undefined) {
      return yield* new WorkbenchOperationError({
        code: "ask_for_change_failed",
        message: "This Ticket has no repository to run Ask for change in.",
      });
    }
    const markdown = yield* rewrite(input, { ...ticket.value, projectId });
    return yield* store
      .updateTicket({
        id: input.id,
        expectedRevision: input.expectedRevision,
        markdown,
        updatedAt: DateTime.formatIso(yield* DateTime.now),
        writer: { kind: "askForChange" },
      })
      .pipe(staleAsChangedWhileRewriting("ticket_changed"));
  });

  const askForDraftChange = Effect.fn("AskForChangeService.askForDraftChange")(function* (
    input: WorkbenchAskForChangeInput,
  ) {
    const draft = yield* store.getTicketDraft(input.id);
    if (draft.revision !== input.expectedRevision) {
      return yield* new WorkbenchOperationError({
        code: "ticket_draft_changed",
        message: "The brief changed. Review it and ask again.",
      });
    }
    if (draft.phase !== "draft") {
      return yield* new WorkbenchOperationError({
        code: "ticket_draft_busy",
        message: "Ticket preparation is changing. Finish or retry that operation first.",
      });
    }
    // As Start work does, the first selected repository runs it; the anchor until one is chosen.
    const projectId = draft.fields.repositoryProjectIds[0] ?? draft.anchorProjectId;
    const markdown = yield* rewrite(input, { ...draft.fields, projectId });
    return yield* store
      .updateTicketDraft({
        id: input.id,
        expectedRevision: input.expectedRevision,
        fields: { ...draft.fields, markdown },
        writer: { kind: "askForChange" },
      })
      .pipe(staleAsChangedWhileRewriting("ticket_draft_changed"));
  });

  return AskForChangeService.of({ askForTicketChange, askForDraftChange });
});

export const AskForChangeServiceLive = Layer.effect(AskForChangeService, make);
