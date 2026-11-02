import { Suspense, type ReactNode } from "react";

import { MarkdownCodeBlock, SuspenseShikiCodeBlock } from "../components/chat/MarkdownCodeBlock";
import { extractCodeBlock, extractFenceLanguage } from "../components/chat/MarkdownCodeBlock.logic";
import { RenderErrorBoundary } from "../components/RenderErrorBoundary";
import { useRenderedAppearance } from "../hooks/useTheme";
import { resolveDiffThemeName } from "../lib/diffRendering";

/** A fenced block in a saved description, framed and highlighted as chat and the editor show it. */
export default function WorkbenchDescriptionCodeBlock({
  children,
  fallback,
}: {
  readonly children: ReactNode;
  readonly fallback: ReactNode;
}) {
  const theme = useRenderedAppearance();
  const block = extractCodeBlock(children);
  if (block === null) return fallback;
  const language = extractFenceLanguage(block.className);
  const plain = <pre>{children}</pre>;
  return (
    // Chat scopes its code block styles, such as the clear Shiki background, to chat markdown.
    <div className="chat-markdown my-3">
      <MarkdownCodeBlock
        code={block.code}
        language={language}
        fenceTitle={null}
        theme={theme}
        isStreaming={false}
      >
        <RenderErrorBoundary resetKeys={[block.code, language, theme]} fallback={plain}>
          <Suspense fallback={plain}>
            <SuspenseShikiCodeBlock
              className={block.className}
              code={block.code}
              themeName={resolveDiffThemeName(theme)}
              isStreaming={false}
            />
          </Suspense>
        </RenderErrorBoundary>
      </MarkdownCodeBlock>
    </div>
  );
}
