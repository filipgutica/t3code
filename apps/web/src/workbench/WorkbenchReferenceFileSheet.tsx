import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";

import { useAssetUrlState } from "../assets/assetUrls";
import { PreviewImage } from "../components/files/PreviewImage";

import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { useEnvironmentQuery } from "../state/query";
import { projectEnvironment } from "../state/projects";
import { WorkbenchDescription } from "./WorkbenchDescription";

function FileContents({
  environmentId,
  cwd,
  path,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
}) {
  // The host reads the file, so this works from a remote client; `cwd` only anchors the request.
  const query = useEnvironmentQuery(
    projectEnvironment.readFile({
      environmentId,
      input: { cwd, relativePath: path, allowMissing: true },
    }),
  );
  if (query.isPending && query.data === null) return <Skeleton className="h-24 w-full" />;
  if (query.data === null) {
    return (
      <p className="text-sm text-muted-foreground">
        This file can't be previewed here. {query.error}
      </p>
    );
  }
  if (query.data.exists === false) {
    return <p className="text-sm text-muted-foreground">This file is no longer available.</p>;
  }
  return (
    <>
      {/\.(?:md|markdown)$/iu.test(path) ? (
        <WorkbenchDescription markdown={query.data.contents} />
      ) : (
        <pre className="max-w-full overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-5 [overflow-wrap:anywhere]">
          {query.data.contents}
        </pre>
      )}
      {query.data.truncated ? (
        <p className="text-xs text-muted-foreground">Only the start of this file is shown.</p>
      ) : null}
    </>
  );
}

/** Images load as a host media asset; it names a Thread, so this uses the Thread that added the file. */
function ImageContents({
  environmentId,
  threadId,
  path,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly path: string;
  readonly label: string;
}) {
  const asset = useAssetUrlState(environmentId, { _tag: "media-file", threadId, path });
  if (asset._tag === "Loading") return <Skeleton className="h-48 w-full" />;
  if (asset._tag === "Failure") {
    return <p className="text-sm text-muted-foreground">This image is no longer available.</p>;
  }
  return <PreviewImage src={asset.url} name={label} />;
}

/** Shows a file Reference read from the environment that owns the Ticket. */
export function WorkbenchReferenceFileSheet({
  environmentId,
  cwd,
  path,
  label,
  addedByThreadId,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
  readonly label: string;
  readonly addedByThreadId: ThreadId | null;
  readonly onClose: () => void;
}) {
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetPopup side="right" className="w-[min(88vw,48rem)] max-w-none">
        <SheetHeader>
          <SheetTitle>{label}</SheetTitle>
          <SheetDescription>
            <span className="break-all font-mono text-xs">{path}</span>
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-6">
          {addedByThreadId !== null && isWorkspaceImagePreviewPath(path) ? (
            <ImageContents
              environmentId={environmentId}
              threadId={addedByThreadId}
              path={path}
              label={label}
            />
          ) : (
            <FileContents environmentId={environmentId} cwd={cwd} path={path} />
          )}
        </div>
      </SheetPopup>
    </Sheet>
  );
}
