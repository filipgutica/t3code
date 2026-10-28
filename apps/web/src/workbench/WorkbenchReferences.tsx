import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  parseWorkbenchReferenceUrl,
  WORKBENCH_REFERENCE_URL_ERROR,
  type EnvironmentId,
  type ThreadId,
  type WorkbenchParsedReferenceUrl,
  type WorkbenchReference,
  type WorkbenchReferenceKind,
  type WorkbenchTicketId,
} from "@t3tools/contracts";
import { BotIcon, CircleDotIcon, ExternalLinkIcon, LinkIcon, PlusIcon, XIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { WorkbenchJiraIcon } from "./WorkbenchJiraIcon";
import {
  WorkbenchTicketPanelHeader,
  useWorkbenchTicketPanelCollapsed,
} from "./WorkbenchTicketPanelHeader";
import { reportWorkbenchCommandFailure } from "./workbenchPageCommands";
import { splitWorkbenchReferences, type WorkbenchReferenceView } from "./workbenchReferences.logic";

const KIND_ICONS = {
  jira_issue: WorkbenchJiraIcon,
  github_issue: CircleDotIcon,
  github_pull_request: PullRequestGlyph.pullRequest,
  link: LinkIcon,
} satisfies Record<WorkbenchReferenceKind, unknown>;

export function WorkbenchReferenceKindIcon({
  kind,
  className,
}: {
  readonly kind: WorkbenchReferenceKind;
  readonly className?: string;
}) {
  const Icon = KIND_ICONS[kind];
  return <Icon aria-hidden className={className} />;
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
export function WorkbenchUrlPopover({
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

function WorkbenchReferenceRow({
  view: { reference, parsed },
  addedBy,
  removeDisabled,
  onRemove,
}: {
  readonly view: WorkbenchReferenceView;
  readonly addedBy: string | null;
  readonly removeDisabled: boolean | null;
  readonly onRemove: () => void;
}) {
  const host = URL.canParse(parsed.url) ? new URL(parsed.url).host : null;
  return (
    <li className="flex min-w-0 items-start gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <a
          href={parsed.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 max-w-full flex-col gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="break-words text-sm font-medium leading-5 [overflow-wrap:anywhere] hover:underline">
            {reference.title ?? parsed.label}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-muted-foreground">
            <WorkbenchReferenceKindIcon kind={parsed.kind} className="size-3.5 shrink-0" />
            {parsed.label !== host ? (
              <span className="truncate font-mono">{parsed.label}</span>
            ) : null}
            {host ? <span className="truncate">{host}</span> : null}
          </span>
        </a>
        {addedBy !== null ? (
          <Badge variant="outline" className="max-w-full">
            <BotIcon />
            <span className="truncate">Added by {addedBy}</span>
          </Badge>
        ) : null}
      </div>
      {removeDisabled === null ? null : (
        <Button
          aria-label={`Remove reference ${reference.title ?? parsed.label}`}
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

/** Links to issues, specs, and designs; pull request References show under Pull requests. */
export function WorkbenchTicketReferencesPanel({
  environmentId,
  ticketId,
  references,
  threadsById,
  archivedThreadsById,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly ticketId: WorkbenchTicketId;
  readonly references: ReadonlyArray<WorkbenchReference>;
  readonly threadsById: ReadonlyMap<ThreadId, Pick<EnvironmentThreadShell, "title">>;
  readonly archivedThreadsById: ReadonlyMap<ThreadId, Pick<EnvironmentThreadShell, "title">>;
  readonly readOnly: boolean;
}) {
  const [collapsed, setCollapsed] = useWorkbenchTicketPanelCollapsed("references");
  const contentId = useId();
  const commands = useWorkbenchReferenceCommands(environmentId);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { listed } = splitWorkbenchReferences(references);
  const editable = !readOnly && commands.canEdit;
  const threadTitle = (threadId: ThreadId | null) =>
    threadId === null
      ? null
      : (threadsById.get(threadId)?.title ??
        archivedThreadsById.get(threadId)?.title ??
        "a Thread");
  const remove = async (url: string) => {
    setPendingUrl(url);
    setError(await commands.remove({ ticketId, url }).finally(() => setPendingUrl(null)));
  };
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
          <ul className="divide-y divide-border/50">
            {listed.map((view) => (
              <WorkbenchReferenceRow
                key={view.reference.url}
                view={view}
                addedBy={threadTitle(view.reference.addedByThreadId)}
                removeDisabled={editable ? pendingUrl !== null : null}
                onRemove={() => void remove(view.reference.url)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">No references yet.</p>
        )}
        {error ? (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
