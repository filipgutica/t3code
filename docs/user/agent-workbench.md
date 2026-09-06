# Agent Workbench

Agent Workbench adds a small planning layer to T3 Code without replacing its native Agent experience.

Open **Agent Workbench** from the sidebar. Use **Add Workspace** in the Workspaces sidebar and link the T3 Projects that its tickets may target. Inside it you can:

- create Story or Bug tickets from an editable Markdown template;
- create Epics and group the Board into Jira-style Epic swimlanes;
- attach each ticket to one or more Workspace repositories and choose its primary repository;
- open a ticket into its focused Ticket workspace, then use **Edit** when its title or context needs to change;
- move tickets directly from a card through Todo, In Progress, and Done;
- start work in a native T3 Thread and see its live delivery state from the Board.

To rename a Workspace or add repositories, open its Board and choose **Edit Workspace** (the settings icon in the header). Select additional T3 Projects and choose **Save changes**. If a directory is missing from the list, add it as a T3 Project first. Already-linked repositories stay linked; existing Tickets and Threads keep their repository scope.

Mirrored Tickets display a Jira icon and their issue key in a linked badge. Local Tickets offer **Archive** and **Delete** in the Ticket detail view. Archive hides a Ticket from the active Board; use **Archived Tickets** to restore it. Delete removes the Ticket from Workbench. Both actions keep native Threads and repository worktrees. Jira mirrors cannot be archived or deleted locally.

**Start work** lets you choose a provider, model, and model options before it prepares one Git worktree for every repository attached to the Ticket, creates the T3 Thread in the primary repository worktree, records its Assignment to the Ticket, sends the accepted ticket context as the first turn, and opens the Thread. The Ticket workspace shows the shared branch and each prepared repository path. Additional repository worktrees can be opened in your preferred editor, while the native Thread remains rooted in the primary repository.

A Ticket can have several active Threads. Use **New Thread** to choose a provider and model for another conversation. When a Ticket already has an active Thread, the new conversation opens blank: Workbench sends no Ticket prompt and starts no turn. Use **Attach existing Thread** to link an unassigned conversation from the Ticket’s primary repository without changing its content or workspace. Each linked Thread can be opened or deleted from the Ticket; deletion uses native T3 confirmation and preserves the Ticket’s shared worktrees.

If a Thread is archived, the ticket offers **Restore Thread** and returns it to T3's active Thread list before opening it. If the Thread was deleted, **Start replacement** creates a new native Thread and Assignment while keeping the previous Assignment in the ticket's history. If native Thread cleanup also removed its worktree, replacement work safely prepares a fresh Ticket Workspace first. Archived historical Threads can be restored from that history.

A Thread opened from a Workbench Ticket stays inside the Agent Workbench frame: the Workspaces sidebar remains visible, the header keeps the Workspace and Ticket context, and separate links return to the Board or exact Ticket. Use **Back to Threads** to restore the regular T3 sidebar. On a Ticket-linked Thread, this keeps the same conversation open. Opening that Thread through normal T3 navigation also uses the regular sidebar; its Board and Ticket backlinks remain available. The Ticket workspace keeps its active Thread and earlier Thread history together. Each Workbench database belongs to one connected T3 environment; records are not combined across remote environments in this first slice.

The Board fits the available width without horizontal scrolling. Ticket titles and previews truncate on cards; open a Ticket to read the full content. Descriptions render formatting when viewed and show their raw source when edited. On desktop, the description and collapsible detail panels scroll internally, with Save and Cancel kept visible. Narrow screens stack the panels.

Unsaved Ticket edits remain available if you close the Ticket or switch Workspaces during the current Workbench session. Reopen the Ticket to continue editing, or use **Cancel** to discard the draft.

Agent activity is shown separately from Ticket progress: **Blocked / needs input**, **Working**, or **Ready for review**. These labels come from the native Thread and never move a Ticket between columns. Jira flags are shown separately as **Jira flagged**. Existing Tickets in the former Ready for Review column move to In Progress.

## Jira sprint mirrors

A Workspace can mirror the connected user's assigned Tickets from a Jira board, including a board that spans several Jira projects. Choose **Connect Jira**, authorize an Atlassian site, then select the board and the sprints to mirror. The sprint list supports one, some, or all of the listed sprints through individual checkboxes and **Select all**. Set the default repository scope and status mappings, then save. Issues included in more than one selected sprint appear once on the Workbench Board.

Use **Sync** for an immediate refresh. With **Follow selected sprints automatically** enabled, an active mirror checks every five minutes while the server is running. Sprints that are still active remain selected. Workbench replaces closed sprints when the newly active candidates identify a complete replacement set. It preserves the previous Board and shows an actionable error when replacements are missing or ambiguous. A sprint already observed running alongside the selection is not treated as a successor. **Select all** selects the sprints currently listed; it does not automatically include unrelated future sprints.

Turn off automatic following to pin the selection. You can pause the mirror without removing its imported Tickets or configuration, then resume it later. All selected sprints refresh as one update: if any sprint cannot be read or imported, Workbench keeps the previous Board.

Map Jira statuses to the three default Ticket columns, or enable **Mirror Jira states** to use the Jira board's column names and order. Agent activity remains a separate label in either mode. Jira column changes are picked up on the next successful sync.

Mirrored Tickets share their description and progress with Jira. The Ticket description is also sent to the Agent when work starts. Saving a description or changing progress writes to Jira before Workbench shows the change as synced. Jira workflow permissions and available transitions still apply. Workbench owns repository scope, Ticket Workspaces, Assignments, and native T3 Threads. Jira Tickets that leave the selected sprints are removed from the active Board without being deleted from Workbench history. Refresh also pulls description and status changes made in Jira. Open Boards, Tickets, and Epics refresh their local view automatically and when the app regains focus; the server checks Jira every five minutes while the mirror is active.

The Jira OAuth app must be configured by the environment operator before **Connect Jira** can authorize a site. Authorization happens on Atlassian's website. If access expires, is revoked, or was granted before issue editing was enabled, open the mirror settings and choose **Reconnect Jira** to grant issue write access. Reconnect with the same Jira site to retain its existing mirror and Ticket history. Cancelling authorization leaves the existing mirror unchanged.

This experiment does not include general Artifacts, mobile UI, multi-environment boards, or automatic ticket status changes based on Agent activity.
