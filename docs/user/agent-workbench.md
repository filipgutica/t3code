# Agent Workbench

Agent Workbench adds a small planning layer to T3 Code without replacing its native Agent experience.

Open **Agent Workbench** from the sidebar. Use **Add Workspace** in the Workspaces sidebar and link the T3 Projects that its tickets may target. Inside it you can:

- create Story or Bug tickets from an editable Markdown template;
- attach each ticket to one or more Workspace repositories and choose its primary repository;
- open a ticket into its focused Ticket workspace, then use **Edit** when its title or context needs to change;
- move tickets directly from a card through Todo, In Progress, Ready for Review, and Done;
- mark a ticket blocked without changing its workflow status;
- start work in a native T3 Thread and see its live delivery state from the Board.

**Start work** creates the T3 Thread, records its Assignment to the ticket, sends the accepted ticket context as the first turn, and opens the Thread. Sending, provider sessions, worktrees, terminals, diffs, approvals, and recovery remain normal T3 Code behavior. The primary repository supplies the Thread's T3 Project; additional repositories remain attached as delivery context until Ticket checkout provisioning is added.

If that Thread is archived, the ticket offers **Restore Thread** and returns it to T3's active Thread list before opening it. If the Thread was deleted, **Start replacement** creates a new native Thread and Assignment while keeping the previous Assignment in the ticket's history. Archived historical Threads can be restored from that history.

An assigned Thread stays inside the Agent Workbench frame: the Workspaces sidebar remains visible, the header keeps the Workspace and Ticket context, and separate links return to the Board or exact Ticket. The Ticket workspace keeps its active Thread and earlier Thread history together. Each Workbench database belongs to one connected T3 environment; records are not combined across remote environments in this first slice.

On narrow screens, use the column navigator above the Board to jump between statuses. Swiping the Board updates the selected column.

Unsaved Ticket edits remain available if you close the Ticket or switch Workspaces during the current Workbench session. Reopen the Ticket to continue editing, or use **Cancel** to discard the draft.

This experiment does not include Epics, general Artifacts, mobile UI, multi-environment boards, or automatic ticket status changes based on Agent activity.
