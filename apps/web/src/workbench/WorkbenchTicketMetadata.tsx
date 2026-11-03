import type { WorkbenchParsedReferenceUrl } from "@t3tools/contracts";
import { CopyIcon, LinkIcon, TicketIcon } from "lucide-react";

import { MenuItem } from "../components/ui/menu";
import { toastManager } from "../components/ui/toast";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";

export function WorkbenchTicketIcon() {
  return <TicketIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
}

/** `issue` is the Ticket's first issue Reference, which also serves as its ID. */
export function WorkbenchTicketCopyMenuItems({
  ticketId,
  issue,
}: {
  ticketId: string;
  issue: WorkbenchParsedReferenceUrl | null;
}) {
  const copy = async ({
    value,
    target,
    copiedTitle,
  }: {
    value: string;
    target: string;
    copiedTitle: string;
  }) => {
    try {
      if (await writeTextToClipboard(value, target))
        toastManager.add({ type: "success", title: copiedTitle, description: value });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not copy ticket details",
        description: cause instanceof Error ? cause.message : "Please try again.",
      });
    }
  };
  return (
    <>
      <MenuItem
        onClick={() =>
          void copy({
            value: issue?.label ?? ticketId,
            target: "ticket ID",
            copiedTitle: "Ticket ID copied",
          })
        }
      >
        <CopyIcon /> Copy ticket ID
      </MenuItem>
      {issue ? (
        <MenuItem
          onClick={() =>
            void copy({
              value: issue.url,
              target: "issue link",
              copiedTitle: "Issue link copied",
            })
          }
        >
          <LinkIcon /> Copy issue link
        </MenuItem>
      ) : null}
    </>
  );
}
