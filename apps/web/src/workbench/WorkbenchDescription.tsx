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
    <pre className="my-3 max-w-full overflow-x-hidden whitespace-pre-wrap rounded-md bg-muted p-3 [overflow-wrap:anywhere]">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <table className="my-3 w-full table-fixed border-collapse">{children}</table>
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
    <div className="min-w-0 max-w-[96ch] text-sm leading-relaxed [overflow-wrap:anywhere] [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_h1]:mb-2 [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li>p]:my-0 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_th]:border [&_th]:p-2 [&_td]:border [&_td]:p-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={descriptionComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
