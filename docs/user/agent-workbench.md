# Workbench user guide

Workbench gives you one view of work across repositories: what’s to do, in progress,
and done. Each Ticket brings together its context, agents, pull requests, and an
isolated work area with worktrees for the repositories involved.

Workbench is available in the web and desktop clients. Each T3 environment has its
own Workspaces and Tickets, so records do not appear across environments. There is
no dedicated Workbench mobile interface yet.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/board-light.png">
  <img src="./media/workbench/board.png" alt="Beacon Board with a saved draft above Tickets across Todo, In Progress, and Done.">
</picture>

The screenshots use fictional Orbit and Beacon projects in an isolated demo.
Planning conversations and prepared Git worktrees are real. PR feedback and
implementation outcomes are illustrative; they do not show completed product work.

For a tabbed overview, open the [screenshot walkthrough](https://filipgutica.github.io/t3code/#walkthrough-heading).

## Create a Workspace and Ticket

A **Workbench workspace** groups T3 Projects that belong together. Linked Projects
must point to Git repositories. A **Ticket** describes work to do; an **Epic** groups
related Tickets. A Ticket's **work area** contains its prepared repository worktrees.

1. Add the repositories you need as T3 Projects.
2. Open **Agent Workbench**, choose **Add Workspace**, select the Projects, and
   choose **Create Workspace**.
3. Open the Workspace Board and choose **New Ticket**.
4. Describe what you want to work on in the planning conversation. Choose your
   model using the native conversation controls.
5. Review the proposed title, plan, acceptance criteria, and repository scope.
   Choose **Apply to draft**, then edit any field. Use **Write** or **Preview** for the description.
6. Choose **Create ticket** to save it.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/planning-light.png">
  <img src="./media/workbench/planning.png" alt="A native planning conversation proposes a Ticket beside its editable draft.">
</picture>

You do not need a title or repository selection before starting the conversation.
Planning can read the workspace's repositories, run commands, and write notes
outside them, but it is told not to change them or start implementing. Ask
follow-up questions to refine the proposal. Applying a new proposal replaces the
draft's title, description, and repository selection; it does not create the Ticket.

Planning can use your configured connectors, web tools, the browser, and CLI tools
such as `gh` for research. With a Jira connector, the agent looks for existing
issues that cover your request; see [Jira links](#jira-links). Planning runs in
Auto, so the provider's automatic reviewer handles approval requests instead of
you.

Leaving the view keeps the draft in the Board’s **Drafts** section and the Workbench
sidebar. Open it to resume its conversation and saved fields. Choose **New Ticket**
to explore another idea in a separate draft. Planning conversations stay in
Workbench until you start work.

**Create manually** opens the form when you already know the requirements.

To plan without leaving the Board, use the chat in its lower-right corner. It
lists the Threads of the Workspace's Tickets and drafts. At the
end of its Thread menu, choose **New ticket draft** to start a planning conversation
there, or **New Thread on** the open Thread's Ticket to start another Thread for that
Ticket. A draft offers **Create ticket** and then **Start work**, and keeps the same
Thread throughout. **Cancel** removes a
draft you have not used yet and returns to the Thread you had open. Choose **Open
full Thread** to edit its fields.

Creating the Ticket keeps the same conversation for further planning. Choose
**Start work** when ready to prepare its work area and continue that Thread in the
primary worktree. Start work does not send a message; send your next instruction
to begin implementation. Planning supports Codex and Claude providers.

The primary repository is where new Threads open. A Ticket can include other
repositories when the work spans several codebases. Use **Edit Workspace** to
rename a Workspace or add repositories; existing Tickets and Threads
keep their scope.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/ticket-light.png">
  <img src="./media/workbench/ticket.png" alt="A prepared Ticket with its description and the same native planning Thread.">
</picture>

## Archive or delete a Workspace

Choose **Archive Workspace** from the Workspace actions menu to hide it from the
active list and attention counts. Open **Archived Workspaces** in the sidebar to
inspect its Tickets and Epics. Archived planning is read-only, and linked native
Threads remain available. Choose **Restore Workspace** to resume planning.
Restoration keeps individual Ticket and Epic archive states.

Choose **Delete Workspace** from the same menu and review the Ticket and Epic
counts before confirming. Deletion permanently removes the Workspace's planning
data from Workbench. Native Projects, Threads, Git worktrees, branches, commits,
and linked Jira issues remain. There is no undo. **Retained worktrees**
in the sidebar remains available for cleanup even after deleting the last Workspace.

## Start agent work

For a Ticket prepared through a conversation, choose **Start work** to continue
that same Thread in its prepared work area. Review the Ticket context chip in the
composer, add your next instruction, and send when ready.

For a manually created Ticket, or an additional conversation:

1. Open a Ticket and choose **Create Thread**.
2. If the work area is not prepared, review the primary and additional repositories.
   Select a provider and model, then choose **Create work area and Thread**.
   Prepared work areas show the repositories that the new Thread will reuse.
3. Review the Ticket context chip in the native Thread composer.
4. Add instructions and send the message.

Creating a Thread does not start an agent turn. Workbench prepares one Git
worktree per selected repository and opens the Thread in the primary repository's
worktree. The context chip includes the Ticket description and repository paths.

To prepare worktrees before opening a conversation, choose **Prepare work area**
in **Work area**, review the repositories, and confirm.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/workspace-light.png">
  <img src="./media/workbench/workspace.png" alt="A prepared Ticket work area with worktrees for Beacon Docs (primary) and Beacon CLI.">
</picture>

After changing the Ticket, use **Add ticket context** in an existing
Thread to stage its saved requirements and current checkout paths. Review the
context chip and send when ready; attaching context does not send a message.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/thread-light.png">
  <img src="./media/workbench/thread.png" alt="The same native Thread continues from planning into the prepared Ticket work area.">
</picture>

Use **Create Thread** for another conversation on the same Ticket. Use **Link existing
Thread** to add an unassigned native conversation, or **Unlink Thread from Ticket**
to remove the association without deleting it. **Settle** moves a conversation out
of the active group; **Thread history** keeps earlier conversations available.

Opening a Thread from a Ticket keeps the Workbench context visible. Use the Board
or Ticket links to return to the work, or choose **Back to Threads** to restore the
regular T3 sidebar. The command palette also offers **Open Workbench**, **New
Ticket** for the current Workspace, and **Back to Ticket** from a linked Thread.

To talk to a Ticket's Threads without leaving the Ticket, use the ticket chat in its
bottom-right corner. Its header shows the open Thread; select it to switch between the
Ticket's Threads, find settled and archived ones, or choose **New Thread**. After a
Thread finishes a run, the menu can show a short recap of it, and Threads on the same
Ticket read each other's recaps so they know what the others are doing. When other
Threads wait for your approval or input, or their run failed, **N need you** opens the
menu on the first of them. A Thread you create from the Ticket opens here. Select the message field
to expand the conversation, or choose **Show ticket chat** in the command palette.
Drag the chat's left edge, top edge, or top-left corner to resize it. The chat leaves out the Thread's side panels:
opening a file or diff from it, or choosing **Open full Thread**, opens the Thread itself.
The ticket chat is not available on narrow screens or while a Ticket is still being
planned.

## Follow progress and review results

Ticket progress and agent activity describe different states:

| Ticket progress          | Agent activity                    |
| ------------------------ | --------------------------------- |
| To Do, In Progress, Done | Working, Waiting, Approval, Input |

Thread activity uses the same status as native Threads, including elapsed time
while working. A Ticket summarizes its current linked Threads: approval requests,
input requests, and failures take priority over work in progress. Notifications
and **Needs attention** remain available separately for reviewing results.

When a linked Thread starts a turn, a To Do Ticket moves to In Progress. **A
completed agent turn does not mark the Ticket Done.** Review the result, then set
the Ticket progress from the Ticket or Board card menu when the work is accepted.

Use **Needs attention** on the Board, or in the sidebar's filter menu, to find
approval and input requests, failed runs, failed PR checks, PR feedback, plans
ready for review, and finished agent turns. The sidebar filter sorts the most
urgent work first. **Agent replies** narrows the Board to completed agent work
awaiting review. PR inspection covers explicitly linked PRs; the Board shows
incomplete or unavailable coverage and lets you refresh.

Each Ticket and Thread shows its most urgent reason in the status area, with
**+N** for other reasons. Click it to see the reasons grouped by Thread and PR.
Thread reasons open the Thread; failed checks, requested changes, and unresolved
discussions open the PR. The Ticket page keeps these actions in its **Needs
attention** section. Opening the list does not clear them.

Opening a Thread acknowledges its notification. A pending question or approval
stays until you respond, and an interrupted run is not a reason. PR actions
remain until the checks or review feedback are resolved.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/notifications-light.png">
  <img src="./media/workbench/notifications.png" alt="A Ticket's attention list showing interrupted runs, failed checks, requested changes, and unresolved PR discussions.">
</picture>

The Ticket's **Pull Requests** section collects PRs reported by linked Threads and
prepared worktrees. For a Ticket with a Jira link, it also searches linked
repositories for the issue key. To attach a PR yourself, choose **Link PR** from
the Ticket, select a Thread if prompted, then choose a listed PR or search by
title. You can paste a full PR URL when browsing is unavailable or the PR is not
listed. A number such as `#42` refers to the selected Thread's repository. Link PR
needs a live assigned Thread and a project with a supported Git remote in the same
environment. You can also use **Link pull request to thread** in the native
Thread's command palette.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/pull-request-light.png">
  <img src="./media/workbench/pull-request.png" alt="A linked PR opened beside its Ticket, with its summary and failing checks visible.">
</picture>

## Edit and organize Tickets

Use Board search to find loaded Tickets by title or Jira issue key. Filter by any
repository in their scope. Search, repository filtering, grouping, and the
selected Board column are retained per Workspace when returning from a Ticket.
Open a Ticket and choose **Edit** to change its title or description. Saved
descriptions display formatting. Board previews use a separate summary generated
from **Settings → General → Text generation model**. Regenerate it from the Ticket
menu when needed; the summary does not replace the full description sent to the
agent.

Choose **New Epic** from the Workspace actions menu, assign related Tickets, and
use the Board's **Group** toggle to show Epic swimlanes. On desktop, drag
Tickets between status columns.

Archive a Ticket to hide it from the active Board, or restore it from
**Archived**. Deleting a Ticket removes it from Workbench but keeps its native
Threads and repository worktrees.

## Manage repositories and worktrees

Choose **Edit** in **Work area** to change the Ticket's repositories. Use **Add
repository** to add one, and a repository's **⋯** menu to make it primary or
remove it. Changes stay marked as Adding or Removing until you choose **Save
changes**; **Cancel** restores the saved choices. Adding repositories to a
prepared work area prepares their worktrees together after saving. **Create
Thread** can change any repository while the Ticket has no prepared worktrees.
After preparation, it can only add repositories; change the primary or remove a
prepared repository in **Work area**.

Threads using the same Ticket worktree share its files, branch, and uncommitted
changes. Existing Threads keep their working directory and sent context when the
Ticket's repository scope changes. Adding a repository to an already prepared
work area prepares its worktree; removing one keeps its worktree and local
changes so it can be added again later.

Creating a Workspace groups existing Projects; it does not create repository
directories. **Prepare work area** creates worktrees without opening a Thread, and
**Create Thread** prepares missing worktrees and reuses existing ones. Creating or
viewing a Ticket alone does not prepare worktrees.

To remove prepared worktrees, delete Threads that still use them, including archived
Threads. Unlink Threads working elsewhere. Commit or preserve local changes, then open **Ticket
work area → Advanced work area settings → Remove prepared worktrees** and confirm.
The reset removes worktrees but keeps the Ticket, branches, and commits.

After deleting a Ticket or Workspace, open **Retained worktrees** in the Workbench sidebar to
remove its kept worktrees. Review the listed repository paths, choose **Remove**,
and confirm. The same Thread ownership and local-change checks apply.

## Jira links

Workbench does not connect to Jira. A Ticket or Epic can link to one Jira issue,
and your agent does any Jira work through its own Jira connector.

To link an issue yourself, open the Ticket or Epic details and choose **Link
issue** under **Jira issue**. Paste the issue's URL, such as
`https://your-site.atlassian.net/browse/PROJ-123`. Use **Change** or **Unlink** to
replace or remove the link.

If your agent has a Jira connector, ask it to find, create, or update an issue in
a planning or work conversation. Workbench tells the agent to change Jira only
when you ask. When it has the issue, it posts a link card; choose **Link** to
link the issue to the Ticket. In a draft, the card waits until you choose
**Create ticket**.

The issue key appears on the Board, in the sidebar, and in Ticket details, and
Board search matches it. The Ticket's **Pull Requests** section also finds PRs
that mention the key. Branch names include the key when the work area is
prepared, so link the issue before you prepare it.

Workspaces that synced with Jira in an earlier version keep their Tickets and
Epics as ordinary records with their issue links. Workbench no longer updates
them from Jira; edit, move, archive, or delete them like any other record.
Tickets whose issues had left the selected sprints are archived. If an earlier
version could not confirm that it created a Jira issue, the Ticket or Epic stays
a local record, linked only if its issue key was known. Check Jira and link the
issue yourself if needed.

## Troubleshooting

| Problem                                           | What to check                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| The agent has not started after creating a Thread | Send a message; creation only prepares the conversation.                               |
| A completed turn leaves the Ticket In Progress    | Review the result and update progress yourself.                                        |
| A repository is missing from a Workspace          | Add its directory as a T3 Project first.                                               |
| A prepared worktree is missing                    | Remove Threads that use it, reset the Ticket work area, then prepare again.            |
| The agent cannot find or create Jira issues       | Set up a Jira connector for that provider; Workbench does not connect to Jira itself.  |
| Workspaces or Tickets seem to be missing          | Check the connected environment; each environment has separate records and saved data. |

For connecting another device, see [Remote access](./remote-access.md).
