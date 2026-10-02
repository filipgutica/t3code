import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { workbenchDescriptionMarkdown } from "./workbenchDescription.logic";

const descriptionComponents: Components = {
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="my-3 max-w-full overflow-x-auto rounded-md bg-muted p-3">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="my-3 max-w-full overflow-x-auto">
      <table className="w-full border-collapse">{children}</table>
    </div>
  ),
};

export function WorkbenchDescription({
  markdown,
  jira = false,
}: {
  readonly markdown: string;
  readonly jira?: boolean;
}) {
  const content = useMemo(() => workbenchDescriptionMarkdown(markdown, jira), [markdown, jira]);
  if (!content.trim())
    return <p className="text-sm text-muted-foreground">No description added yet.</p>;
  return (
    <div className="min-w-0 max-w-[75ch] text-sm leading-relaxed [overflow-wrap:anywhere] [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_h1]:mb-2 [&_h1]:mt-5 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:font-semibold [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li>p]:my-0 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:align-top">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={descriptionComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
