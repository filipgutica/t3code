# Agent Workbench

Agent Workbench adds a small planning layer to T3 Code without replacing its native Agent experience.

Open **Agent Workbench** from the sidebar. Use **Add Workspace** in the Workspaces sidebar and link the T3 Projects that its tickets may target. Inside it you can:

- create Story or Bug tickets from an editable Markdown template;
- create Epics and group the Board into Jira-style Epic swimlanes;
- attach each ticket to one or more Workspace repositories and choose its primary repository;
- open a ticket into its focused Ticket workspace, then use **Edit** when its title or context needs to change;
- move tickets directly from a card through Todo, In Progress, Ready for Review, and Done;
- mark a ticket blocked without changing its workflow status;
- start work in a native T3 Thread and see its live delivery state from the Board.

**Start work** prepares one Git worktree for every repository attached to the Ticket, creates the T3 Thread in the primary repository worktree, records its Assignment to the Ticket, sends the accepted ticket context as the first turn, and opens the Thread. The Ticket workspace shows the shared branch and each prepared repository path. Additional repository worktrees can be opened in your preferred editor, while the native Thread remains rooted in the primary repository.

If that Thread is archived, the ticket offers **Restore Thread** and returns it to T3's active Thread list before opening it. If the Thread was deleted, **Start replacement** creates a new native Thread and Assignment while keeping the previous Assignment in the ticket's history. Archived historical Threads can be restored from that history.

An assigned Thread stays inside the Agent Workbench frame: the Workspaces sidebar remains visible, the header keeps the Workspace and Ticket context, and separate links return to the Board or exact Ticket. The Ticket workspace keeps its active Thread and earlier Thread history together. Each Workbench database belongs to one connected T3 environment; records are not combined across remote environments in this first slice.

On narrow screens, use the column navigator above the Board to jump between statuses. Swiping the Board updates the selected column.

Unsaved Ticket edits remain available if you close the Ticket or switch Workspaces during the current Workbench session. Reopen the Ticket to continue editing, or use **Cancel** to discard the draft.

## Jira sprint mirrors

A Workspace can mirror the current user's assigned Tickets from one Jira sprint. Choose **Connect Jira** in the Workspace header, authorize an Atlassian site, then select a Jira project, Board, sprint, default repository scope, and status mappings. Use **Sync** for an immediate refresh; an active binding also refreshes in the background. You can pause the mirror without removing its imported Tickets or configuration, then resume it later.

Jira owns a mirrored Ticket's summary, type, Epic, blocked flag, sprint membership, rank, and Board status, including while the mirror is paused. Workbench owns its instructions, repository scope, Ticket Workspace, Assignments, and native T3 Threads. Jira Tickets that leave the selected sprint are removed from the active Board without being deleted from Workbench history. This first integration is pull-only and does not write changes back to Jira.

The Jira OAuth app must be configured by the environment operator before **Connect Jira** can authorize a site.

This experiment does not include general Artifacts, mobile UI, multi-environment boards, Jira writeback, or automatic ticket status changes based on Agent activity.
