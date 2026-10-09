import { useNavigate } from "@tanstack/react-router";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, type ReactNode } from "react";

import { useEnvironmentQuery } from "../state/query";
import { workbenchEnvironment } from "./state";
import { WorkbenchTicketProposalHistory } from "./WorkbenchTicketProposal";

/** Preparation stays in its Workbench view even when a native Thread link is opened. */
export function WorkbenchThreadPreparationGate({
  threadRef,
  children,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly children: ReactNode;
}) {
  const query = useEnvironmentQuery(
    threadRef === null
      ? null
      : workbenchEnvironment.ticketPreparations({
          environmentId: threadRef.environmentId,
          input: {},
        }),
  );
  const preparation =
    threadRef === null || query.isPending || !query.isSuccess
      ? undefined
      : query.data?.find((item) => item.threadId === threadRef.threadId);
  const navigate = useNavigate();
  const environmentId = threadRef?.environmentId;
  useEffect(() => {
    if (!preparation || environmentId === undefined) return;
    const ticketId = preparation.ticketId ?? preparation.draftId;
    void navigate({
      to: "/workbench",
      search: {
        environmentId,
        workbenchProjectId: preparation.projectId,
        ...(ticketId ? { ticketId } : { create: "ticket" as const }),
      },
      replace: true,
    });
  }, [navigate, preparation, environmentId]);
  return preparation ? null : (
    <WorkbenchTicketProposalHistory threadRef={threadRef}>
      {children}
    </WorkbenchTicketProposalHistory>
  );
}
