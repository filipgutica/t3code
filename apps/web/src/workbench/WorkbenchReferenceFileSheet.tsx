import type { EnvironmentId } from "@t3tools/contracts";

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

/** Shows a file Reference read from the environment that owns the Ticket. */
export function WorkbenchReferenceFileSheet({
  environmentId,
  cwd,
  path,
  label,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
  readonly label: string;
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
          <FileContents environmentId={environmentId} cwd={cwd} path={path} />
        </div>
      </SheetPopup>
    </Sheet>
  );
}
