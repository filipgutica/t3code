import "./WorkbenchTicketDescriptionEditor.css";

import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useState } from "react";

import { Label } from "../components/ui/label";
import { cn } from "../lib/utils";
import { Textarea } from "../components/ui/textarea";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { workbenchDescriptionProseClassName } from "./WorkbenchDescription";
import { WorkbenchReferenceChip, useWorkbenchReferenceOpener } from "./WorkbenchReferenceLink";
import { WorkbenchProvenanceBadge } from "./WorkbenchReferences";
import {
  descriptionEditorContent,
  descriptionEditorExtensions,
  descriptionUsesJiraMarkup,
  parseDescription,
  serializeDescription,
} from "./workbenchDescriptionEditor.logic";
import { parseDescriptionHref } from "./workbenchReferences.logic";

type Mode = "rich" | "markdown";

export function WorkbenchTicketDescriptionEditor({
  id = "edit-workbench-ticket-context",
  markdown,
  jira,
  updatedBy = null,
  onChange,
}: {
  id?: string;
  markdown: string;
  jira: boolean;
  /** The agent Thread that last wrote the description, if one did. */
  updatedBy?: string | null;
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
        <div className="flex min-w-0 items-center gap-2">
          <Label id={labelId} htmlFor={mode === "markdown" ? id : undefined}>
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
          className="min-h-72"
          placeholder="Goal, constraints, and acceptance criteria…"
          value={markdown}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      ) : (
        <DescriptionRichTextEditor
          labelId={labelId}
          markdown={markdown}
          jira={jira}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function DescriptionRichTextEditor({
  labelId,
  markdown,
  jira,
  onChange,
}: {
  labelId: string;
  markdown: string;
  jira: boolean;
  onChange: (markdown: string) => void;
}) {
  const [loaded, setLoaded] = useState(() => ({
    parsed: parseDescription(markdown, jira),
    emitted: markdown,
    generation: 0,
  }));
  // Markdown this editor didn't write, such as an agent's edit to a draft, reloads it.
  if (markdown !== loaded.emitted) {
    setLoaded({
      parsed: parseDescription(markdown, jira),
      emitted: markdown,
      generation: loaded.generation + 1,
    });
  }
  return (
    <DescriptionRichTextSurface
      key={loaded.generation}
      labelId={labelId}
      parsed={loaded.parsed}
      onChange={(next) => {
        setLoaded((current) => ({ ...current, emitted: next }));
        onChange(next);
      }}
    />
  );
}

function DescriptionRichTextSurface({
  labelId,
  parsed,
  onChange,
}: {
  labelId: string;
  parsed: ReturnType<typeof parseDescription>;
  onChange: (markdown: string) => void;
}) {
  const opener = useWorkbenchReferenceOpener();
  const editor = useEditor({
    extensions: descriptionEditorExtensions,
    content: descriptionEditorContent(parsed),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": labelId,
        class: cn(workbenchDescriptionProseClassName, "min-h-72 max-w-none px-3 py-2 outline-none"),
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
      {editor ? (
        <BubbleMenu editor={editor} shouldShow={({ editor: current }) => current.isActive("link")}>
          {reference ? (
            <div className="rounded-md border border-border bg-popover p-1 shadow-md">
              <WorkbenchReferenceChip reference={reference} title={null} opener={opener} />
            </div>
          ) : null}
        </BubbleMenu>
      ) : null}
    </div>
  );
}
