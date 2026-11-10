import type { Element, ElementContent, Root } from "hast";
import { createContext, lazy, Suspense, use, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { parseDescriptionHref } from "./workbenchReferences.logic";
import {
  WorkbenchReferenceChip,
  useWorkbenchReferenceOpener,
  type WorkbenchReferenceOpener,
} from "./WorkbenchReferenceLink";

// Chat's code block loads Shiki and client settings, so only descriptions with code fetch it.
const DescriptionCodeBlock = lazy(() => import("./WorkbenchDescriptionCodeBlock"));

const DescriptionOpenerContext = createContext<WorkbenchReferenceOpener | null>(null);

/**
 * Puts each top-level block's Markdown source offsets on its element, which a selection reads.
 * Blocks without a position, such as footnotes, get none.
 */
const rehypeSourceRanges = () => (tree: Root) => {
  for (const node of tree.children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (node.type !== "element" || start === undefined || end === undefined) continue;
    node.properties.dataSourceStart = start;
    node.properties.dataSourceEnd = end;
  }
};

/** The source attributes of a top-level block, for components that render their own wrapper. */
export type DescriptionSourceAttributes = {
  readonly "data-source-start"?: number;
  readonly "data-source-end"?: number;
};

const sourceAttributes = (node: Element | undefined): DescriptionSourceAttributes => {
  const { dataSourceStart, dataSourceEnd } = node?.properties ?? {};
  return typeof dataSourceStart === "number" && typeof dataSourceEnd === "number"
    ? { "data-source-start": dataSourceStart, "data-source-end": dataSourceEnd }
    : {};
};

const hastText = (nodes: ReadonlyArray<ElementContent>): string =>
  nodes
    .map((node) =>
      node.type === "text" ? node.value : node.type === "element" ? hastText(node.children) : "",
    )
    .join("");

/** A link to a Reference is a chip that opens beside the chat; other links open a new tab. */
function DescriptionLink({
  href,
  text,
  children,
}: {
  readonly href: string | undefined;
  readonly text: string;
  readonly children: ReactNode;
}) {
  const opener = use(DescriptionOpenerContext);
  const reference = href === undefined ? null : parseDescriptionHref(href);
  if (opener === null || reference === null) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
        {children}
      </a>
    );
  }
  const title = text.trim();
  return (
    <WorkbenchReferenceChip
      reference={reference}
      title={title === "" || title === href || title === reference.url ? null : title}
      opener={opener}
    />
  );
}

const descriptionComponents: Components = {
  a: ({ children, href, node }) => (
    <DescriptionLink href={href} text={hastText(node?.children ?? [])}>
      {children}
    </DescriptionLink>
  ),
  pre: ({ children, node }) => {
    const source = sourceAttributes(node);
    const plain = (
      <pre className="my-3 max-w-full overflow-x-auto rounded-md bg-muted p-3" {...source}>
        {children}
      </pre>
    );
    return (
      <Suspense fallback={plain}>
        <DescriptionCodeBlock fallback={plain} source={source}>
          {children}
        </DescriptionCodeBlock>
      </Suspense>
    );
  },
  table: ({ children, node }) => (
    <div className="my-3 max-w-full overflow-x-auto" {...sourceAttributes(node)}>
      <table className="w-full border-collapse">{children}</table>
    </div>
  ),
};

/** Typography for a rendered description, shared by the rich-text editor. */
export const workbenchDescriptionProseClassName =
  "min-w-0 max-w-[75ch] text-sm leading-relaxed [overflow-wrap:anywhere] [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_h1]:mb-2 [&_h1]:mt-5 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:font-semibold [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li>p]:my-0 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-foreground/10 [&_:not(pre)>code]:px-1 [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:text-left [&_th]:[overflow-wrap:normal] [&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:align-top";

export function WorkbenchDescription({ markdown }: { readonly markdown: string }) {
  const opener = useWorkbenchReferenceOpener();
  if (!markdown.trim()) return <p className="text-sm text-muted-foreground">No brief added yet.</p>;
  return (
    <div className={workbenchDescriptionProseClassName}>
      <DescriptionOpenerContext value={opener}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSourceRanges]}
          components={descriptionComponents}
        >
          {markdown}
        </ReactMarkdown>
      </DescriptionOpenerContext>
    </div>
  );
}
