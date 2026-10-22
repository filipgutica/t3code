import { StrictMode, type ButtonHTMLAttributes, type ReactNode } from "react";
import { act, render } from "../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  WorkbenchJiraBindingId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchJiraGetTicketTransitionsResult,
  type WorkbenchJiraIssueLink,
  type WorkbenchTicket,
} from "@t3tools/contracts";

import { WorkbenchJiraDropDialog } from "./WorkbenchJiraDropDialog";

const query = vi.hoisted(() => ({
  data: null as WorkbenchJiraGetTicketTransitionsResult | null,
  error: null as string | null,
  isPending: false,
  refresh: vi.fn(),
}));
vi.mock("../state/query", () => ({ useEnvironmentQuery: () => query }));
vi.mock("./state", () => ({ workbenchEnvironment: { jiraGetTicketTransitions: () => null } }));
vi.mock("../components/ui/dialog", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Container,
    DialogDescription: Container,
    DialogFooter: Container,
    DialogHeader: Container,
    DialogPanel: Container,
    DialogPopup: Container,
    DialogTitle: Container,
  };
});
vi.mock("../components/ui/button", () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));

const timestamp = "2026-09-11T12:00:00.000Z";
const ticket: WorkbenchTicket = {
  id: WorkbenchTicketId.make("ticket-1"),
  projectId: WorkbenchProjectId.make("workspace-1"),
  epicId: null,
  title: "Move this ticket",
  kind: "story",
  markdown: "",
  primaryT3ProjectId: ProjectId.make("repository-1"),
  repositoryProjectIds: [],
  status: "todo",
  blocked: false,
  revision: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const jiraIssueLink: WorkbenchJiraIssueLink = {
  bindingId: WorkbenchJiraBindingId.make("binding-1"),
  ticketId: ticket.id,
  issue: {
    issueId: "10001",
    key: "WB-1",
    url: "https://example.atlassian.net/browse/WB-1",
    summary: ticket.title,
    issueType: { id: "story", name: "Story" },
    status: { id: "todo", name: "To Do" },
    epic: null,
    flagged: false,
    rank: 0,
    remoteUpdatedAt: timestamp,
  },
  active: true,
  linkedAt: timestamp,
  lastSeenAt: timestamp,
};
const start = {
  id: "start",
  name: "Start work",
  to: { id: "doing", name: "In Progress" },
  unavailableReason: null,
};
const onTransition = vi.fn();
const onClose = vi.fn();
const renderDialog = (columnTitle = "In Progress") => (
  <StrictMode>
    <WorkbenchJiraDropDialog
      environmentId={EnvironmentId.make("environment-1")}
      ticket={ticket}
      jiraIssueLink={jiraIssueLink}
      columnTitle={columnTitle}
      jiraStatusIds={["doing"]}
      onTransition={onTransition}
      onClose={onClose}
    />
  </StrictMode>
);
function setup() {
  vi.clearAllMocks();
  query.data = { remoteUpdatedAt: timestamp, transitions: [start] };
  query.error = null;
  query.isPending = false;
}

describe("Jira status drop submission", () => {
  it("submits one available transition once across StrictMode effects and rerenders", async () => {
    setup();
    await using screen = await render(renderDialog());
    await screen.rerender(renderDialog("Doing"));
    expect(onTransition).toHaveBeenCalledExactlyOnceWith({
      ticket,
      transitionId: "start",
      destination: start.to,
      expectedRemoteUpdatedAt: timestamp,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("waits for the chosen action when Jira offers multiple transitions", async () => {
    setup();
    query.data = {
      remoteUpdatedAt: timestamp,
      transitions: [start, { ...start, id: "resume", name: "Resume work" }],
    };
    await using screen = await render(renderDialog());
    expect(onTransition).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: /^Resume work\b/ }).click();
    expect(onTransition).toHaveBeenCalledExactlyOnceWith({
      ticket,
      transitionId: "resume",
      destination: start.to,
      expectedRemoteUpdatedAt: timestamp,
    });
  });

  it("applies a cached transition immediately while refreshing, only once", async () => {
    setup();
    query.isPending = true;
    await using screen = await render(renderDialog());
    expect(onTransition).toHaveBeenCalledExactlyOnceWith({
      ticket,
      transitionId: "start",
      destination: start.to,
      expectedRemoteUpdatedAt: timestamp,
    });
    query.isPending = false;
    await screen.rerender(renderDialog());
    expect(onTransition).toHaveBeenCalledOnce();
  });

  it("keeps cached actions usable after a background refresh error", async () => {
    setup();
    query.error = "Jira is unavailable";
    await using screen = await render(renderDialog());
    expect(onTransition).toHaveBeenCalledExactlyOnceWith({
      ticket,
      transitionId: "start",
      destination: start.to,
      expectedRemoteUpdatedAt: timestamp,
    });
  });

  it("allows retry after an error when no cached actions exist", async () => {
    setup();
    query.data = null;
    query.error = "Jira is unavailable";
    await using screen = await render(renderDialog());
    expect(onTransition).not.toHaveBeenCalled();
    await screen.getByRole("button").first().click();
    expect(query.refresh).toHaveBeenCalledOnce();
    query.error = null;
    query.data = { remoteUpdatedAt: timestamp, transitions: [start] };
    await screen.rerender(renderDialog("In Progress"));
    expect(onTransition).toHaveBeenCalledOnce();
  });

  it("leaves the ticket unchanged when dismissed while loading", async () => {
    setup();
    query.data = null;
    query.isPending = true;
    await using screen = await render(renderDialog());
    await screen.getByRole("button").first().click();
    expect(onClose).toHaveBeenCalledOnce();
    await screen.unmount();
    query.data = { remoteUpdatedAt: timestamp, transitions: [start] };
    query.isPending = false;
    await act(async () => {});
    expect(onTransition).not.toHaveBeenCalled();
  });
});
