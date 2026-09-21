# Workbench user guide

Workbench gives you one view of work across repositories: what’s to do, in progress,
and done. Each Ticket brings together its context, agents, pull requests, and an
isolated workspace with worktrees for the repositories involved.

Workbench is available in the web and desktop clients. Jira is optional. Each T3
environment has its own Workspaces and Tickets, so records do not appear across
environments. There is no dedicated Workbench mobile interface yet.

![Orbit Workspace with Tickets across Todo, In Progress, and Done, and repository context on each card.](./media/workbench/board.png)

The examples use fictional Orbit and Beacon projects in an isolated demo
environment. The repository worktrees and linked demo pull requests are real.

## Create a Workspace and Ticket

A **Workspace** groups T3 Projects that belong together. Linked Projects must point
to Git repositories. A **Ticket** describes work to do; an **Epic** groups related
Tickets.

1. Add the repositories you need as T3 Projects.
2. Open **Agent Workbench**, choose **Add Workspace**, select the Projects, and
   choose **Create Workspace**.
3. Open the Workspace Board and choose **New Ticket**.
4. Enter a title and description, select the repositories, and choose the primary
   repository.
5. Choose **Create Ticket**.

The primary repository is where new Threads open. A Ticket can include other
repositories when the work spans several codebases. Use **Edit Workspace** to
rename a Workspace or change its repository list; existing Tickets and Threads
keep their scope.

## Start agent work

[Watch: create a Ticket, prepare worktrees, and inspect Thread context (38 seconds).](./media/workbench/create-ticket-worktrees.mp4)

1. Open a Ticket and review **Ticket workspace**, including the repository scope
   and **Primary repository**.
2. Choose **Prepare workspace** if you want to create worktrees before opening a
   conversation. **Create Thread** prepares missing worktrees automatically.
3. Choose **Create Thread**, select a provider and model, and review the Ticket
   context chip in the native Thread composer.
4. Add instructions and send the message.

Creating a Thread does not start an agent turn. Workbench prepares one Git
worktree per selected repository and opens the Thread in the primary repository's
worktree. The context chip includes the Ticket description and repository paths.

![Ticket context containing the description, acceptance criteria, and paths to both repository worktrees.](./media/workbench/ticket-context.png)

Use **New Thread** for another conversation on the same Ticket. Use **Link existing
Thread** to add an unassigned native conversation, or **Unlink Thread from Ticket**
to remove the association without deleting it. **Settle** moves a conversation out
of the active group; **Thread history** keeps earlier conversations available.

Opening a Thread from a Ticket keeps the Workbench context visible. Use the Board
or Ticket links to return to the work, or choose **Back to Threads** to restore the
regular T3 sidebar.

## Follow progress and review results

Ticket progress and agent activity describe different states:

| Ticket progress          | Agent activity                               |
| ------------------------ | -------------------------------------------- |
| To Do, In Progress, Done | Waiting for input, Working, Ready for review |

When a linked Thread starts a turn, a To Do Ticket moves to In Progress. **A
completed agent turn does not mark the Ticket Done.** Review the result, then set
the Ticket progress from the Ticket or Board card menu when the work is accepted.
For Jira Tickets, Workbench attempts an available Jira transition first; if it
fails, the Thread continues and its work log shows a warning.

The Ticket's **Pull Requests** section collects PRs reported by linked Threads and
prepared worktrees. For Jira Tickets, it also searches linked repositories for the
issue key. To attach a PR yourself, open the Thread, open the command palette with
**⌘K** on macOS or **Ctrl+K** on Windows and Linux, choose **Link pull request to
thread**, and paste the full PR URL. A number such as `#42` refers to the Thread's
repository.

![One Ticket showing pull requests from Orbit Web and Orbit API, alongside its Thread and prepared repository worktrees.](./media/workbench/pull-requests.png)

[Watch: link a pull request and review it from the Ticket (36 seconds).](./media/workbench/link-pull-requests.mp4)

## Edit and organize Tickets

Use Board search to find loaded Tickets by title or Jira key. Open a Ticket and
choose **Edit** to change its title or description. Saved descriptions display
formatting; imported Jira descriptions are also written to Jira. Board previews
use a separate summary generated from **Settings → General → Text generation
model**. Regenerate it from the Ticket menu when needed; the summary does not
replace the full description sent to the agent.

Choose **New Epic** from the Workspace actions menu, assign related Tickets, and
use the Board's **Group** toggle to show Epic swimlanes. On desktop, drag local
Tickets between status columns. Jira-managed Tickets use Jira's transition flow.

Archive a local Ticket to hide it from the active Board, or restore it from
**Archived**. Deleting a local Ticket removes it from Workbench but keeps its
native Threads and repository worktrees. Imported Jira Tickets cannot be archived
or deleted locally.

## Manage repositories and worktrees

Threads using the same Ticket worktree share its files, branch, and uncommitted
changes. Existing Threads keep their working directory and sent context when the
Ticket's repository scope changes. Adding a repository to an already prepared
workspace prepares its worktree; removing one keeps its worktree and local
changes so it can be added again later.

Creating a Workspace groups existing Projects; it does not create repository
directories. **Prepare workspace** creates worktrees without opening a Thread, and
**Create Thread** prepares missing worktrees and reuses existing ones. Creating,
importing, or viewing a Ticket alone does not prepare worktrees.

To remove prepared worktrees, delete Threads that still use them, including archived
Threads. Unlink Threads working elsewhere. Commit or preserve local changes, then open **Ticket
workspace → Advanced workspace settings → Remove prepared worktrees** and confirm.
The reset removes worktrees but keeps the Ticket, branches, and commits.

## Connect Jira

A Workspace can import issues assigned to the connected Jira user from a board and
selected sprints. Imported issues become Tickets and show a Jira link; importing
does not create worktrees. A published Workbench desktop release uses a hosted Jira
connection, so authorization happens on Atlassian's website without creating an
OAuth app. For a source-based environment, see the [local Jira setup
instructions](../../README.md#set-up-jira-for-local-development).

To connect a Workspace, choose **Connect Jira → Connect Atlassian**, authorize on
Atlassian's website, then select the site, board, sprints, default repository scope,
and status mapping. **Mirror Jira states** uses the board's column names and order.
If the Workspace has local Tickets or Epics, choose whether to publish them to Jira
or delete them before importing. Deleting requires an exact-count confirmation;
native Agent Threads remain in history. Save the configuration to start the first
sync.

![Orbit Workspace showing imported Jira issues alongside local Tickets, with To Do, In Progress, In Review, and Done columns.](./media/workbench/jira-board.png)

Use **Sync Jira** for an immediate refresh. Jira controls issue descriptions,
status, Epic relationships, and sprint membership. Workbench controls repository
selection, Ticket worktrees, linked Threads, and generated summaries. Changes made
in Jira appear on the next successful sync; issues that leave the selected sprints
leave the active Board but remain in Workbench history.

[Watch: sync Jira and open an imported Ticket (26 seconds).](./media/workbench/jira-sync.mp4)

**New Ticket** in a Jira-linked Workspace creates an issue in the configured Jira
project and assigns it to the connected account. If access expires, choose
**Reconnect Jira**, authorize again, and use the same site to retain the mirror and
Ticket history. Cancelling authorization leaves the existing mirror unchanged.

## Troubleshooting

| Problem                                           | What to check                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| The agent has not started after creating a Thread | Send a message; creation only prepares the conversation.                                     |
| A completed turn leaves the Ticket In Progress    | Review the result and update progress yourself.                                              |
| A repository is missing from a Workspace          | Add its directory as a T3 Project first.                                                     |
| A prepared worktree is missing                    | Remove Threads that use it, reset the Ticket workspace, then prepare again.                  |
| Jira cannot advance or import issues              | Check the selected board, sprints, assignment, and Jira permissions, then reconnect or sync. |
| Workspaces or Tickets seem to be missing          | Check the connected environment; each environment has separate records and saved data.       |

For connecting another device, see [Remote access](./remote-access.md).
