import "./WorkbenchTicketDescriptionEditor.css";

import { newlineInCode } from "@tiptap/pm/commands";
import { Fragment, Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
  type NodeViewProps,
} from "@tiptap/react";
import { useState } from "react";

import {
  convertCodeFenceOnEnter,
  exitCodeBlockOnClosingFence,
  exitCodeBlockOnTrailingBlankLines,
  indentCodeBlock,
  indentedNewlineInCodeBlock,
  selectionInOneCodeBlock,
} from "../composer-code-block";
import { ComposerCodeBlockNodeView } from "../components/chat/ComposerCodeBlockNodeView";
import { composerCodeBlockHighlight } from "../components/composerCodeBlockHighlight";
import { Label } from "../components/ui/label";
import { resolveDiffThemeName } from "../lib/diffRendering";
import { cn } from "../lib/utils";
import { Textarea } from "../components/ui/textarea";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { workbenchDescriptionProseClassName } from "./WorkbenchDescription";
import { WorkbenchReferenceChip, useWorkbenchReferenceOpener } from "./WorkbenchReferenceLink";
import { WorkbenchProvenanceBadge } from "./WorkbenchReferences";
import {
  descriptionEditorContent,
  descriptionEditorExtensions,
  descriptionPasteContent,
  descriptionUsesJiraMarkup,
  DescriptionCodeBlock,
  parseDescription,
  ReferenceChip,
  serializeDescription,
} from "./workbenchDescriptionEditor.logic";
import { parseDescriptionHref } from "./workbenchReferences.logic";

type Mode = "rich" | "markdown";

function ReferenceChipView({ node }: NodeViewProps) {
  const opener = useWorkbenchReferenceOpener();
  const href = String(node.attrs.href);
  const title = node.attrs.title as string | null;
  const reference = parseDescriptionHref(href);
  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      {reference ? (
        <WorkbenchReferenceChip reference={reference} title={title} opener={opener} />
      ) : (
        (title ?? href)
      )}
    </NodeViewWrapper>
  );
}

const editorExtensions = [
  ...descriptionEditorExtensions.map((extension) => {
    if (extension === ReferenceChip) {
      return ReferenceChip.extend({ addNodeView: () => ReactNodeViewRenderer(ReferenceChipView) });
    }
    if (extension !== DescriptionCodeBlock) return extension;
    // The composer's code block: header with a language picker, highlighted by the plugin below.
    return DescriptionCodeBlock.extend({
      addNodeView: () =>
        ReactNodeViewRenderer(ComposerCodeBlockNodeView, {
          stopEvent: ({ event }) =>
            event.target instanceof Element &&
            event.target.closest(".chat-markdown-codeblock-header") !== null,
        }),
    });
  }),
  composerCodeBlockHighlight({
    resolveTheme: () =>
      resolveDiffThemeName(document.documentElement.classList.contains("dark") ? "dark" : "light"),
  }),
];

/** As in the composer: fences open and close on Enter, and Tab indents code. */
function handleCodeKeys(view: EditorView, event: KeyboardEvent): boolean {
  const dispatch = (tr: Transaction) => view.dispatch(tr.scrollIntoView());
  if (event.key === "Tab" && selectionInOneCodeBlock(view.state)) {
    event.preventDefault();
    return indentCodeBlock(view.state, event.shiftKey ? "out" : "in", dispatch);
  }
  if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey) return false;
  if (event.isComposing) return false;
  if (selectionInOneCodeBlock(view.state)) {
    return (
      exitCodeBlockOnClosingFence(view.state, dispatch) ||
      exitCodeBlockOnTrailingBlankLines(view) ||
      indentedNewlineInCodeBlock(view.state, dispatch) ||
      newlineInCode(view.state, dispatch)
    );
  }
  return convertCodeFenceOnEnter(view.state, dispatch);
}

/** A pasted URL or path becomes a chip, titled by any selected text; other text is Markdown. */
function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  const text = event.clipboardData?.getData("text/plain");
  if (!text || (event.clipboardData?.files.length ?? 0) > 0) return false;
  const { state } = view;
  const marks = state.storedMarks ?? state.selection.$from.marks();
  const inInlineCode = state.schema.marks.code?.isInSet(marks);
  if (selectionInOneCodeBlock(state) || inInlineCode) {
    view.dispatch(state.tr.insertText(text).scrollIntoView());
    return true;
  }
  const href = text.trim();
  const chip = state.schema.nodes.referenceChip;
  if (chip && !/\n/.test(href) && parseDescriptionHref(href) !== null) {
    const { from, to, empty } = state.selection;
    const title = empty ? null : state.doc.textBetween(from, to) || null;
    view.dispatch(
      state.tr.replaceSelectionWith(chip.create({ href, title }), false).scrollIntoView(),
    );
    return true;
  }
  const doc = ProseMirrorNode.fromJSON(state.schema, descriptionPasteContent(text));
  if (doc.childCount === 0) return false;
  // Only paragraphs merge into the text around the caret; code blocks, tables, and lists stay whole.
  const opens = (node: ProseMirrorNode | null) => (node?.type.name === "paragraph" ? 1 : 0);
  let content = doc.content;
  if (content.childCount === 1 && opens(content.firstChild) === 1) {
    // Parsing trims the edges, but a pasted phrase keeps the spaces around it.
    const [, before = "", after = ""] = /^([ \t]*)[\s\S]*?([ \t]*)$/.exec(text) ?? [];
    const space = (value: string) =>
      value ? Fragment.from(state.schema.text(value)) : Fragment.empty;
    const inline = space(before).append(content.firstChild!.content).append(space(after));
    content = Fragment.from(content.firstChild!.copy(inline));
  }
  const slice = new Slice(content, opens(content.firstChild), opens(content.lastChild));
  view.dispatch(state.tr.replaceSelection(slice).scrollIntoView());
  return true;
}

export function WorkbenchTicketDescriptionEditor({
  id = "edit-workbench-ticket-context",
  autoFocus = false,
  markdown,
  jira,
  updatedBy = null,
  disabled = false,
  onChange,
}: {
  id?: string;
  /** Puts the caret at the start of the description when the editor opens. */
  autoFocus?: boolean;
  markdown: string;
  jira: boolean;
  /** The agent Thread that last wrote the description, if one did. */
  updatedBy?: string | null;
  /** A contenteditable ignores a disabled `<fieldset>`, so callers pass it. */
  disabled?: boolean;
  onChange: (markdown: string) => void;
}) {
  // Jira wiki markup has no rich-text form, so it opens as source.
  const [mode, setMode] = useState<Mode>(() =>
    descriptionUsesJiraMarkup(markdown, jira) ? "markdown" : "rich",
  );
  const labelId = `${id}-label`;
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Label className="shrink-0" id={labelId} htmlFor={mode === "markdown" ? id : undefined}>
            Description
          </Label>
          {updatedBy !== null ? (
            <WorkbenchProvenanceBadge text={`Updated by ${updatedBy}`} />
          ) : null}
        </div>
        <ToggleGroup
          aria-label="Ticket description editor mode"
          variant="segmented"
          value={[mode]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "rich" || value === "markdown") setMode(value);
          }}
        >
          <Toggle value="rich" type="button">
            Rich text
          </Toggle>
          <Toggle value="markdown" type="button">
            Markdown
          </Toggle>
        </ToggleGroup>
      </div>
      {mode === "markdown" ? (
        <Textarea
          id={id}
          autoFocus={autoFocus}
          className="min-h-72"
          placeholder="Goal, constraints, and acceptance criteria…"
          value={markdown}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      ) : (
        <DescriptionRichTextEditor
          labelId={labelId}
          autoFocus={autoFocus}
          markdown={markdown}
          jira={jira}
          disabled={disabled}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function DescriptionRichTextEditor({
  labelId,
  autoFocus,
  markdown,
  jira,
  disabled,
  onChange,
}: {
  labelId: string;
  autoFocus: boolean;
  markdown: string;
  jira: boolean;
  disabled: boolean;
  onChange: (markdown: string) => void;
}) {
  const [loaded, setLoaded] = useState(() => ({
    parsed: parseDescription(markdown, jira),
    emitted: markdown,
    disabled,
    generation: 0,
  }));
  // Markdown this editor didn't write, such as an agent's edit to a draft, reloads it, and
  // so does a change to `disabled`, which Tiptap reads only on creation.
  if (markdown !== loaded.emitted || disabled !== loaded.disabled) {
    setLoaded({
      parsed: parseDescription(markdown, jira),
      emitted: markdown,
      disabled,
      generation: loaded.generation + 1,
    });
  }
  return (
    <DescriptionRichTextSurface
      key={loaded.generation}
      labelId={labelId}
      // A reload, such as an agent's edit, shouldn't take focus from where you're typing.
      autoFocus={autoFocus && loaded.generation === 0}
      parsed={loaded.parsed}
      disabled={disabled}
      onChange={(next) => {
        setLoaded((current) => ({ ...current, emitted: next }));
        onChange(next);
      }}
    />
  );
}

function DescriptionRichTextSurface({
  labelId,
  autoFocus,
  parsed,
  disabled,
  onChange,
}: {
  labelId: string;
  autoFocus: boolean;
  parsed: ReturnType<typeof parseDescription>;
  disabled: boolean;
  onChange: (markdown: string) => void;
}) {
  const opener = useWorkbenchReferenceOpener();
  const editor = useEditor({
    extensions: editorExtensions,
    content: descriptionEditorContent(parsed),
    editable: !disabled,
    autofocus: autoFocus ? "start" : false,
    editorProps: {
      handleKeyDown: handleCodeKeys,
      handlePaste: (view, event) => handlePaste(view, event),
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": labelId,
        class: cn(
          workbenchDescriptionProseClassName,
          "min-h-72 max-w-none px-3 py-2 outline-none [&_a]:text-primary [&_a]:underline",
        ),
      },
    },
    onUpdate: ({ editor: current }) => onChange(serializeDescription(current.state.doc, parsed)),
  });
  const href = useEditorState({
    editor,
    selector: ({ editor: current }): unknown =>
      current?.isActive("link") ? current.getAttributes("link").href : null,
  });
  const reference = typeof href === "string" ? parseDescriptionHref(href) : null;
  return (
    <div
      data-workbench-description-editor
      className="min-w-0 rounded-lg border border-input bg-background has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-inset has-focus-visible:ring-ring/24 dark:bg-input/32"
    >
      <EditorContent editor={editor} />
      {typeof href === "string" ? (
        <div className="flex min-w-0 items-center gap-2 border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
          Link
          {reference ? (
            <WorkbenchReferenceChip reference={reference} title={null} opener={opener} />
          ) : URL.canParse(href) ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-primary underline"
            >
              {href}
            </a>
          ) : (
            <span className="truncate">{href}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
