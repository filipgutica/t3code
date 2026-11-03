import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  parseWorkbenchReferenceUrl,
  WORKBENCH_REFERENCE_URL_ERROR,
  type EnvironmentId,
  type ThreadId,
  type WorkbenchParsedReferenceUrl,
  type WorkbenchReference,
  type WorkbenchReferenceDraft,
  type WorkbenchTicketId,
} from "@t3tools/contracts";
import { BotIcon, ExternalLinkIcon, PlusIcon, XIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { WorkbenchReferenceFileSheetProvider } from "./WorkbenchReferenceFileSheet";
import { WorkbenchReferenceKindIcon } from "./WorkbenchReferenceKindIcon";
import {
  WorkbenchReferenceHoverCard,
  workbenchReferenceOpenNote,
  workbenchReferenceTarget,
  useWorkbenchReferenceOpener,
  type WorkbenchReferenceOpener,
} from "./WorkbenchReferenceLink";
import {
  WorkbenchTicketPanelHeader,
  useWorkbenchTicketPanelCollapsed,
} from "./WorkbenchTicketPanelHeader";
import { reportWorkbenchCommandFailure } from "./workbenchPageCommands";
import {
  listWorkbenchTicketReferences,
  splitWorkbenchReferences,
  type WorkbenchDescriptionLink,
  type WorkbenchReferenceView,
} from "./workbenchReferences.logic";

type ThreadTitles = ReadonlyMap<ThreadId, Pick<EnvironmentThreadShell, "title">>;

export const workbenchThreadTitle = (
  threadId: ThreadId | null | undefined,
  threadsById: ThreadTitles,
  archivedThreadsById: ThreadTitles,
): string | null =>
  threadId == null
    ? null
    : (threadsById.get(threadId)?.title ?? archivedThreadsById.get(threadId)?.title ?? "a Thread");

/** Marks content an agent Thread wrote, such as "Added by Planning". */
export function WorkbenchProvenanceBadge({ text }: { readonly text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant="outline" className="min-w-0 max-w-72 shrink" />}>
        <BotIcon aria-hidden />
        <span className="truncate">{text}</span>
      </TooltipTrigger>
      <TooltipPopup>{text}</TooltipPopup>
    </Tooltip>
  );
}

/** An issue Reference's label, opening its URL. */
export function WorkbenchReferenceBadge({
  reference,
  size = "default",
  className,
}: {
  readonly reference: WorkbenchParsedReferenceUrl;
  readonly size?: "default" | "control";
  readonly className?: string;
}) {
  return (
    <Badge
      size={size}
      variant="info"
      render={<a href={reference.url} target="_blank" rel="noopener noreferrer" />}
      aria-label={`Open ${reference.label}`}
      onClick={(event) => event.stopPropagation()}
      className={className}
    >
      <WorkbenchReferenceKindIcon kind={reference.kind} />
      <span className="font-mono">{reference.label}</span>
      <ExternalLinkIcon />
    </Badge>
  );
}

/** Adds or removes a Ticket's References; the result arrives with the refreshed snapshot. */
export function useWorkbenchReferenceCommands(environmentId: EnvironmentId) {
  const add = useAtomCommand(workbenchEnvironment.addReference, {
    reportFailure: false,
    reportDefect: false,
  });
  const remove = useAtomCommand(workbenchEnvironment.removeReference, {
    reportFailure: false,
    reportDefect: false,
  });
  const canEdit = useAtomValue(workbenchEnvironment.addReference.permissionAtom(environmentId));
  const failureOf = (result: Parameters<typeof reportWorkbenchCommandFailure>[0]) => {
    let message: string | null = null;
    reportWorkbenchCommandFailure(result, (failure) => {
      message = failure;
    });
    return message;
  };
  return {
    canEdit,
    add: async (input: {
      readonly ticketId: WorkbenchTicketId;
      readonly url: string;
      readonly title?: string;
    }): Promise<string | null> => failureOf(await add({ environmentId, input })),
    remove: async (input: {
      readonly ticketId: WorkbenchTicketId;
      readonly url: string;
    }): Promise<string | null> => failureOf(await remove({ environmentId, input })),
  };
}

interface WorkbenchUrlFormProps {
  readonly heading: string;
  readonly inputLabel: string;
  readonly placeholder: string;
  readonly emptyHint: string;
  readonly invalidMessage: string;
  readonly submitLabel: string;
  readonly initialUrl?: string;
  /** The hint for a URL the form accepts, or `null` to reject it. */
  readonly describe: (url: string) => string | null;
  readonly withTitle?: boolean;
  /** Resolves to an error message, or `null` to close the popover. */
  readonly onSubmit: (input: {
    readonly url: string;
    readonly title?: string;
  }) => Promise<string | null>;
}

/** A URL form in a popover; the form remounts, and so resets, each time the popover opens. */
function WorkbenchUrlPopover({
  trigger,
  triggerVariant,
  disabled,
  ...form
}: WorkbenchUrlFormProps & {
  readonly trigger: ReactNode;
  readonly triggerVariant: "ghost" | "outline";
  readonly disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button size="xs" type="button" variant={triggerVariant} disabled={disabled} />}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverPopup width="md" padding="compact" align="end">
        <WorkbenchUrlForm {...form} onClose={() => setOpen(false)} />
      </PopoverPopup>
    </Popover>
  );
}

function UrlFormHint({
  id,
  error,
  hint,
}: {
  readonly id: string;
  readonly error: string | null;
  readonly hint: string;
}) {
  return error === null ? (
    <p id={id} className="text-muted-foreground text-xs">
      {hint}
    </p>
  ) : (
    <p id={id} role="alert" className="text-destructive text-xs">
      {error}
    </p>
  );
}

function WorkbenchUrlForm({
  heading,
  inputLabel,
  placeholder,
  emptyHint,
  invalidMessage,
  submitLabel,
  initialUrl = "",
  describe,
  withTitle = false,
  onSubmit,
  onClose,
}: WorkbenchUrlFormProps & { readonly onClose: () => void }) {
  const [url, setUrl] = useState(initialUrl);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const helpId = useId();
  const hint = describe(url);
  const submit = async () => {
    if (hint === null) {
      setError(invalidMessage);
      return;
    }
    setPending(true);
    const trimmedTitle = title.trim();
    const failure = await onSubmit({
      url: url.trim(),
      ...(trimmedTitle ? { title: trimmedTitle } : {}),
    }).finally(() => setPending(false));
    if (failure === null) onClose();
    else setError(failure);
  };
  return (
    <form
      className="space-y-2 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <PopoverTitle>{heading}</PopoverTitle>
      <Input
        aria-label={inputLabel}
        size="sm"
        font="mono"
        autoFocus
        placeholder={placeholder}
        value={url}
        aria-invalid={error !== null}
        aria-describedby={helpId}
        onChange={(event) => {
          setUrl(event.target.value);
          setError(null);
        }}
      />
      {withTitle ? (
        <Input
          aria-label="Title (optional)"
          size="sm"
          placeholder="Title (optional)"
          maxLength={500}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      ) : null}
      <UrlFormHint id={helpId} error={error} hint={hint ?? emptyHint} />
      <div className="flex justify-end gap-2">
        <Button size="xs" type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="xs" type="submit" disabled={pending || url.trim() === ""}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

interface ReferenceRowView {
  readonly url: string;
  readonly title: string | null;
  readonly parsed: WorkbenchParsedReferenceUrl;
  readonly addedByThreadId: ThreadId | null;
  /** Where the Reference comes from, for its hover card, such as "added by Planning". */
  readonly source: string | undefined;
  /** A link in the description, removed by editing the description. */
  readonly fromDescription: boolean;
}

const descriptionRow = ({ parsed, title }: WorkbenchDescriptionLink): ReferenceRowView => ({
  url: parsed.url,
  title,
  parsed,
  addedByThreadId: null,
  source: "from the description",
  fromDescription: true,
});

function WorkbenchReferenceRow({
  view,
  opener,
  removeDisabled,
  onRemove,
}: {
  readonly view: ReferenceRowView;
  readonly opener: WorkbenchReferenceOpener;
  readonly removeDisabled: boolean | null;
  readonly onRemove: () => void;
}) {
  const name = view.title ?? view.parsed.label;
  const opens = workbenchReferenceOpenNote(opener, view.parsed);
  return (
    <li className="flex min-h-8 min-w-0 items-center gap-2">
      <WorkbenchReferenceHoverCard
        reference={view.parsed}
        title={name}
        source={view.source}
        note={view.fromDescription ? `${opens}. Remove it by editing the description.` : opens}
        trigger={workbenchReferenceTarget({
          reference: view.parsed,
          opener,
          addedByThreadId: view.addedByThreadId,
          className:
            "flex min-w-0 flex-1 items-center gap-2 rounded-sm py-1 text-left text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          children: (
            <>
              <WorkbenchReferenceKindIcon
                kind={view.parsed.kind}
                url={view.parsed.url}
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="truncate">{name}</span>
            </>
          ),
        })}
      />
      {view.fromDescription ? (
        <span className="shrink-0 text-xs text-muted-foreground">In description</span>
      ) : removeDisabled === null ? null : (
        <Button
          aria-label={`Remove reference ${name}`}
          size="icon-xs"
          type="button"
          variant="ghost"
          disabled={removeDisabled}
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      )}
    </li>
  );
}

type OwnedReferencesInput = {
  readonly environmentId: EnvironmentId;
  readonly ownerId: WorkbenchTicketId;
  readonly threadsById: ThreadTitles;
  readonly archivedThreadsById: ThreadTitles;
  readonly readOnly: boolean;
};

/** Rows and removal for a saved Ticket's or draft's References. */
function useOwnedReferences({
  environmentId,
  ownerId,
  threadsById,
  archivedThreadsById,
  readOnly,
}: OwnedReferencesInput) {
  const commands = useWorkbenchReferenceCommands(environmentId);
  const opener = useWorkbenchReferenceOpener();
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = !readOnly && commands.canEdit;
  const remove = async (url: string) => {
    setPendingUrl(url);
    setError(await commands.remove({ ticketId: ownerId, url }).finally(() => setPendingUrl(null)));
  };
  return {
    commands,
    editable,
    pendingUrl,
    error,
    savedRow: ({ reference, parsed }: WorkbenchReferenceView): ReferenceRowView => {
      const addedBy = workbenchThreadTitle(
        reference.addedByThreadId,
        threadsById,
        archivedThreadsById,
      );
      return {
        url: reference.url,
        title: reference.title,
        parsed,
        addedByThreadId: reference.addedByThreadId,
        source: addedBy === null ? undefined : `added by ${addedBy}`,
        fromDescription: false,
      };
    },
    rows: (views: ReadonlyArray<ReferenceRowView>) =>
      views.map((view) => (
        <WorkbenchReferenceRow
          key={view.url}
          view={view}
          opener={opener}
          removeDisabled={editable ? pendingUrl !== null : null}
          onRemove={() => void remove(view.url)}
        />
      )),
  };
}

function ReferenceError({ message }: { readonly message: string | null }) {
  return message ? (
    <p role="alert" className="text-destructive text-xs">
      {message}
    </p>
  ) : null;
}

/** Saved References and the description's links; pull requests show under Pull requests. */
export function WorkbenchTicketReferencesPanel({
  ticketId,
  references,
  descriptionLinks,
  ...owner
}: Omit<OwnedReferencesInput, "ownerId"> & {
  readonly ticketId: WorkbenchTicketId;
  readonly references: ReadonlyArray<WorkbenchReference>;
  readonly descriptionLinks: ReadonlyArray<WorkbenchDescriptionLink>;
}) {
  const [collapsed, setCollapsed] = useWorkbenchTicketPanelCollapsed("references");
  const contentId = useId();
  const { commands, editable, pendingUrl, error, rows, savedRow } = useOwnedReferences({
    ...owner,
    ownerId: ticketId,
  });
  const listed = listWorkbenchTicketReferences(references, descriptionLinks).listed.map((item) =>
    item.source === "saved" ? savedRow(item) : descriptionRow(item),
  );
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-border/60 bg-card/40">
      <WorkbenchTicketPanelHeader
        title="References"
        count={listed.length}
        description="Issues, specs, and designs"
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
        contentId={contentId}
        actions={
          editable ? (
            <WorkbenchUrlPopover
              trigger={
                <>
                  <PlusIcon /> Add
                </>
              }
              triggerVariant="outline"
              disabled={pendingUrl !== null}
              heading="Add reference"
              inputLabel="Reference URL"
              placeholder="https://…"
              emptyHint="Paste an issue, spec, design, or doc URL."
              invalidMessage={WORKBENCH_REFERENCE_URL_ERROR}
              submitLabel="Add"
              describe={(url) => {
                const parsed = parseWorkbenchReferenceUrl(url);
                return parsed ? `Adds ${parsed.label}.` : null;
              }}
              withTitle
              onSubmit={(input) => commands.add({ ticketId, ...input })}
            />
          ) : null
        }
      />
      <div id={contentId} hidden={collapsed} className="min-w-0 space-y-2 px-4 pb-4">
        {listed.length > 0 ? (
          <ul>{rows(listed)}</ul>
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">No references yet.</p>
        )}
        <ReferenceError message={error} />
      </div>
    </section>
  );
}

/** An always-visible field: Enter or Add adds the pasted URL or path, and a failure keeps the text. */
function WorkbenchReferencePasteInput({
  disabled,
  onAdd,
}: {
  readonly disabled: boolean;
  readonly onAdd: (url: string) => Promise<string | null>;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const errorId = useId();
  const submit = async () => {
    if (url.trim() === "") return;
    if (parseWorkbenchReferenceUrl(url) === null) {
      setError(WORKBENCH_REFERENCE_URL_ERROR);
      return;
    }
    setPending(true);
    const failure = await onAdd(url.trim()).finally(() => setPending(false));
    if (failure === null) setUrl("");
    setError(failure);
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Add a reference URL"
          size="sm"
          placeholder="Paste a Jira, GitHub, or any URL…"
          value={url}
          disabled={disabled || pending}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          onChange={(event) => {
            setUrl(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void submit();
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || pending || url.trim() === ""}
          onClick={() => void submit()}
        >
          <PlusIcon /> Add
        </Button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReferenceSection({
  rows,
  input,
}: {
  readonly rows: ReadonlyArray<ReactNode>;
  readonly input: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <div className="space-y-0.5">
        <h3 id={headingId} className="font-medium text-sm">
          References
        </h3>
        <p className="text-xs text-muted-foreground">
          Issues, specs, and designs. Paste a link, or ask the agent to find them.
        </p>
      </div>
      {rows.length > 0 ? (
        <ul className="rounded-lg border border-border/60 px-3 py-1">{rows}</ul>
      ) : null}
      {input}
    </section>
  );
}

type DraftReferencesProps = Omit<OwnedReferencesInput, "ownerId"> & {
  readonly draftId: WorkbenchTicketId;
  readonly references: ReadonlyArray<WorkbenchReference>;
};

/** A draft's References, edited in place; agent additions arrive with the snapshot. */
export function WorkbenchDraftReferences({
  fileCwd,
  fileThreadId,
  ...props
}: DraftReferencesProps & {
  /** A repository the host can anchor file reads at; file References open from it. */
  readonly fileCwd: string | null;
  /** One of the draft's Threads, for images a person added; host media reads name a Thread. */
  readonly fileThreadId: ThreadId | null;
}) {
  return (
    <WorkbenchReferenceFileSheetProvider
      environmentId={props.environmentId}
      cwd={fileCwd}
      threadId={fileThreadId}
    >
      <DraftReferences {...props} />
    </WorkbenchReferenceFileSheetProvider>
  );
}

function DraftReferences({ draftId, references, ...owner }: DraftReferencesProps) {
  const { commands, editable, pendingUrl, error, rows, savedRow } = useOwnedReferences({
    ...owner,
    ownerId: draftId,
  });
  // A draft has no Pull requests section yet, so its PR References list here.
  const { listed, pullRequests } = splitWorkbenchReferences(references);
  return (
    <>
      <ReferenceSection
        rows={rows([...listed, ...pullRequests].map(savedRow))}
        input={
          editable ? (
            <WorkbenchReferencePasteInput
              disabled={pendingUrl !== null}
              onAdd={(url) => commands.add({ ticketId: draftId, url })}
            />
          ) : null
        }
      />
      <ReferenceError message={error} />
    </>
  );
}

/** References for a Ticket that does not exist yet; they are sent with Create Ticket. */
export function WorkbenchStagedReferences({
  references,
  disabled,
  onChange,
}: {
  readonly references: ReadonlyArray<WorkbenchReferenceDraft>;
  readonly disabled: boolean;
  readonly onChange: (references: ReadonlyArray<WorkbenchReferenceDraft>) => void;
}) {
  const opener = useWorkbenchReferenceOpener();
  const views = references.flatMap((reference): ReadonlyArray<ReferenceRowView> => {
    const parsed = parseWorkbenchReferenceUrl(reference.url);
    return parsed
      ? [
          {
            url: parsed.url,
            title: reference.title ?? null,
            parsed,
            addedByThreadId: null,
            source: undefined,
            fromDescription: false,
          },
        ]
      : [];
  });
  return (
    <ReferenceSection
      rows={views.map((view) => (
        <WorkbenchReferenceRow
          key={view.parsed.url}
          view={view}
          opener={opener}
          removeDisabled={disabled}
          onRemove={() =>
            onChange(
              references.filter(
                (reference) => parseWorkbenchReferenceUrl(reference.url)?.url !== view.parsed.url,
              ),
            )
          }
        />
      ))}
      input={
        <WorkbenchReferencePasteInput
          disabled={disabled}
          onAdd={async (url) => {
            const parsed = parseWorkbenchReferenceUrl(url);
            if (parsed === null) return WORKBENCH_REFERENCE_URL_ERROR;
            if (!views.some((view) => view.parsed.url === parsed.url)) {
              onChange([...references, { url: parsed.url }]);
            }
            return null;
          }}
        />
      }
    />
  );
}
