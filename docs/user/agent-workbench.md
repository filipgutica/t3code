# Agent Workbench

Agent Workbench adds a small planning layer to T3 Code without replacing its native Agent experience.

Open **Agent Workbench** from the sidebar. Use **Add Workspace** in the Workspaces sidebar and link the T3 Projects that its tickets may target. Inside it you can:

- create tickets with Markdown context;
- review a selected ticket, then use **Edit** when its title or context needs to change;
- move tickets directly from a card through Todo, In Progress, Ready for Review, and Done;
- mark a ticket blocked without changing its workflow status;
- start work in a native T3 Thread.

**Start work** creates the T3 Thread first, records its Assignment to the ticket, preloads the composer with the ticket context, and opens the Thread. Sending, provider sessions, worktrees, terminals, diffs, approvals, and recovery remain normal T3 Code behavior.

If that Thread is later archived or deleted, the ticket offers **Start replacement**. It creates a new native Thread and safely repoints the existing Assignment.

An assigned Thread shows an explicit **Workbench** back button in its header. It returns to the exact Workbench Workspace and Ticket. Each Workbench database belongs to one connected T3 environment; records are not combined across remote environments in this first slice.

On narrow screens, use the column navigator above the Board to jump between statuses. Swiping the Board updates the selected column.

Unsaved Ticket edits remain available if you close the Ticket or switch Workspaces during the current Workbench session. Reopen the Ticket to continue editing, or use **Cancel** to discard the draft.

This experiment does not include Epics, general Artifacts, mobile UI, multi-environment boards, or automatic ticket status changes based on Agent activity.
