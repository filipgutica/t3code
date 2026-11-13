# Workbench user guide

Workbench keeps connected work in one Ticket: the plan, requirements and designs,
a Thread for each PR across repositories, the PRs and what needs you, and recaps
of what each agent did.

This walkthrough follows a fictional Orbit Ticket, **Let invitees recover an
expired invitation**. It has three planned PRs across Orbit API and Orbit Web,
with two PRs linked so far. The demo's Ticket history, PR outcomes, and recaps are
synthetic. The planning conversation and prepared Git worktrees are real.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/ticket-light.png">
  <img src="./media/workbench/ticket.png" alt="Demo Orbit Ticket with its brief, Progress, attention, and Threads for three planned PRs across two repositories.">
</picture>

Workbench is available in the web and desktop clients. Each T3 environment has
its own Workspaces and Tickets, which can include Projects from
[other machines](#repositories-on-other-machines). There is no dedicated Workbench mobile interface
yet. For a visual tour, open the [Workbench site](https://filipgutica.github.io/t3code/).

## Create a Workspace

A **Workbench workspace** groups T3 Projects that belong together. Linked Projects
must point to Git repositories. A **Ticket** describes connected work within that
Workspace. Its **work area** holds the repository worktrees prepared for it.

1. Add the repositories you need as T3 Projects.
2. Open **Agent Workbench**, choose **Add Workspace**, select the Projects, and
   choose **Create Workspace**.

Use **Edit Workspace** to rename it or add repositories. Existing Tickets and
Threads keep their scope.

## Plan a Ticket

Open the Workspace Board, choose **New Ticket**, and describe the change. A
planning Thread opens in the Board chat. You can begin without a title or
repository selection. Choose a model using the native conversation controls;
planning supports Codex and Claude.

As you talk, the agent fills in the draft's title, brief, Progress, and
repositories. It saves longer plans and requirements in the Ticket's artifacts
folder and adds them as [References](#references). Edit the title and repository
selection yourself, or ask the agent to revise the brief and Progress.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/planning-light.png">
  <img src="./media/workbench/planning.png" alt="Planning Thread in the Orbit Board chat with the draft's brief, Progress, and References.">
</picture>

Planning can read the Workspace's repositories, run commands, and write notes
outside them. Its instructions tell it not to change the repositories or start
implementation. It can use your configured research tools and connectors.
Planning runs in Auto, so the provider's automatic reviewer handles approval
requests.

Choose **Create ticket** when the plan is right. Filling in the draft alone does
not create the Ticket, and creating the Ticket prepares no worktrees. The
planning Thread stays attached for further conversation.

Drafts wait in the Board's **Drafts** section and the Workbench sidebar. Open one
to resume its conversation. Choose **New Ticket** to explore another idea.
**Cancel** removes an unused draft; **Discard** removes a used draft after
confirmation. **Create manually** opens the form when you already know the
requirements. If planning fails to start, choose **Retry** or **Create manually**
in the chat.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/board-light.png">
  <img src="./media/workbench/board.png" alt="Orbit Board with the invitation Ticket In Progress and one of three planned PRs complete.">
</picture>

## Brief, Progress, and requirements

Keep the brief short: the goal, open questions, and decisions. Put detailed scope
and acceptance in a requirements file and add it as a Reference. The current
Brief subtitle is “Goal, constraints, and acceptance criteria.” You can keep a
pointer to the requirements there instead of repeating the file.

**Progress** is a checklist the agent maintains, usually one line per task or PR.
Ask it to write the list, revise the plan, or mark completed items. Progress is
read-only in the draft and Ticket; the Board shows its completed and total
counts. In this story, the Orbit API contract is complete, with two Orbit Web
PRs still planned: one of three items checked.

Each Thread receives the brief, Progress, References, prepared worktrees, and
other Threads with their recaps on its first turn. Later turns receive updates.
Expand **Shared context** to read what a new Thread would receive. Saved changes
reach other Threads on their next turn.

When an agent edits the brief, review the change. The review bar names the
Thread that made it and when. An edit already waiting when you open the Ticket
starts hidden; select **Show diff** or the **Updated by** badge to see it, then
**Accept** it or **Undo** it. To talk about the edit with the agent that made it,
select the Thread's name in the review bar to open that Thread in the chat. To
request another revision, use **Ask for change** for the whole brief or a
selected passage.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/agent-edit-light.png">
  <img src="./media/workbench/agent-edit.png" alt="Agent edit to the Ticket brief with the change, Undo, and Accept available for review.">
</picture>

## References

References are current sources a Thread should read: requirements, plans, specs,
designs, issues, docs, and prior or example PRs. This Ticket keeps a requirements
file, a plan by PR, and a self-contained HTML mockup. Link delivery PRs through
their Threads instead of duplicating them as References.

Choose **Add reference** and paste a URL or an absolute file path, with an
optional title. Drafts and the manual Ticket form also have a References field.
Links in the brief appear as chips and in the list marked **In description**;
remove those by editing the brief. Other References have a remove button.
Remove a Reference when its file is superseded, or ask the agent to retitle it
when its status changes.

With a Thread selected in the floating chat, every file Reference, including
HTML and PDF, opens in that Thread's native file panel without leaving the
Ticket. On a Thread page, the breadcrumb's **References** menu lists the Ticket's
files. Other links follow **Settings → Browser**. Hover a chip or row to see its
path or URL. Without a Thread, files use the existing file preview and links use
your browser. HTML relative assets outside the Thread's worktree may not load;
replacing an open HTML or image file may prevent its preview from reloading.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/reference-light.png">
  <img src="./media/workbench/reference.png" alt="Expired-invitation HTML mockup open beside its Thread's conversation on the Ticket.">
</picture>

A file path belongs to the machine running the environment, including when you
connect remotely. A missing file shows as unavailable. Issue References show
their key or repository and number; Board cards show up to two and search matches
them. The first issue Reference also names the branch when the work area is
prepared, so add it before preparation if you want that branch name.

Earlier Jira links are kept as References. Workbench no longer syncs those
Tickets from Jira. If an earlier link is missing, check the issue and add its URL
as a Reference yourself.

## Start agent work

Choose **Start work** to prepare one worktree per Ticket repository and continue
the planning Thread in the first repository's worktree. Start work sends no
message. Send your next instruction when you are ready to begin implementation.

Split the work into a Thread for each PR and choose its repository. Here, one
Thread works on the expiry and resend contract in Orbit API, and two work on the
expired-invitation page and pending invitations list in Orbit Web.

For another Thread, or for a manually created Ticket:

1. Choose **Create Thread** on the Ticket, or **New Thread** in its chat.
2. Choose the repository, provider, and model. The repository defaults to the
   active Thread's repository, or the first one. **Add repository** also lets you
   include another Workspace repository in the Ticket.
3. Choose **Create Thread**, or **Create work area and Thread** when worktrees
   still need preparation.
4. Add instructions and send the first message to start the agent.

Creating a Thread does not start an agent turn. It opens the conversation in the
chosen repository's worktree. To prepare worktrees without opening a Thread,
choose **Prepare work area** in **Work area**.

**Link existing Thread** attaches an unassigned conversation from one of the
Ticket’s repositories. It keeps its history, branch and working directory, which
may be outside the Ticket’s work area. No prompt is sent. To work in the Ticket’s
checkout, use **Create Thread** instead.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/thread-context-light.png">
  <img src="./media/workbench/thread-context.png" alt="Shared context listing the Ticket's Threads with recaps and two prepared repository worktrees.">
</picture>

Threads in the same worktree share its branch, files, and uncommitted changes.
Separate PRs need separate branches, so ask the agent to create another checkout
when needed. PR 3 has a separate Orbit Web checkout for the pending invitations
list. Such checkouts appear in **Work area**; Shared context lists the two
prepared repository worktrees.

Select a Thread in the chat, then use the terminal button at the top right of
the Ticket to open its terminal where that Thread works. The side panel button
opens that Thread's panel too. These controls also work on the Board.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/terminal-light.png">
  <img src="./media/workbench/terminal.png" alt="Pending invitations Thread's terminal showing git status in its separate Orbit Web checkout.">
</picture>

## Chat with Threads

The Board and each Ticket have a floating chat in the lower-right corner. Board
chat lists Threads across the Workspace's Tickets and drafts; Ticket chat lists
that Ticket's Threads. Select the open Thread's name to switch, search, or find
settled and archived Threads. **Unread** holds new replies and Threads waiting
on you, followed by **Idle**, with **Working** and **Settled** collapsed.

After a Thread finishes a run, Workbench writes a short recap. The Thread list
shows a one-line preview under each Thread that has one. Recaps also go into
shared context to help you and the other Threads catch up.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/recaps-light.png">
  <img src="./media/workbench/recaps.png" alt="Ticket Threads menu with status and one-line recap previews, the unread Thread first.">
</picture>

Select the message field to expand the chat, or choose **Show chat** in the
command palette. Drag its left edge, top edge, or top-left corner to resize it.
Clicking elsewhere collapses it; expand it again with your message intact. When
other Threads need approval or input, or their run failed, **N need you** opens
the menu on the first of them.

**Settle Thread** in the header moves the open Thread out of the active group
and shows the Ticket's next one. Open a settled Thread from the menu to
**Un-settle** it. Settling keeps the conversation available.

The chat's **⋯** menu offers **Thread details** and **Open full Thread**. From the
full Thread page, use its Board or Ticket link to return. Files, diffs, side chats,
and PRs open in the Thread's side panel. You can maximize the panel; in a smaller
window it uses a sheet. On narrow screens, the chat is behind its launcher.

In Board chat, **New Thread on** starts a Thread on the open Thread's Ticket;
**New ticket draft** starts a planning conversation. A draft stays pinned above
the chat. **Show full brief** lets you read its brief and Progress and edit its
other fields. Opening its Ticket keeps the chat on the same Thread.

## Follow progress and review results

**Pull requests** collects PRs from the Ticket's Threads and branches. In this
story, Orbit API PR #41 is Merged and Orbit Web PR #88 is Open, with failed checks
and an unresolved review thread. Open a PR beside the Ticket to read its summary,
checks, and review threads.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="./media/workbench/pull-requests-light.png">
  <img src="./media/workbench/pull-requests.png" alt="Ticket with merged Orbit API PR 41 and open Orbit Web PR 88, attention, and PR 88's summary panel.">
</picture>

To attach a delivery PR, choose **Link PR**, select a Thread if prompted, and
choose a PR or search by title. You can paste a full PR URL when browsing is
unavailable. A number such as `#42` refers to the selected Thread's repository.
Link PR needs a live assigned Thread and a supported Git remote in the same
environment. The native command palette also offers **Link pull request to
thread**. Supporting PR References appear in **Pull requests** too; unlinking
one removes only the Reference. A Thread's own PR link stays until unlinked there.

**Needs attention** includes failed checks, requested changes, unresolved review
threads, and Threads with unread replies or requests. Use the Board or sidebar
filter to find what needs you across Tickets. **Agent replies** narrows the Board
to completed agent work awaiting review. PR inspection covers explicitly linked
PRs and reports incomplete or unavailable coverage so you can refresh it.

Each Ticket and Thread shows its most urgent reason and **+N** for others.
Choose it to see reasons grouped by Thread and PR. Opening a Thread acknowledges
its notification; a question or approval request stays until you respond.
Opening the attention list alone clears nothing. A review thread stops counting
once you reply, and counts again after another comment. Resolving it on the host
clears it for good.

**Approved** means the PR is approved, has no failing or pending checks, and has
no merge conflicts. The host can still block merging under other rules. It stays
an attention item while those conditions hold and the PR is open.

## Finish a Ticket

Ticket status and agent activity describe different things. A To Do Ticket moves
to In Progress when a linked Thread starts a turn. Finishing a run or checking
off Progress does not close it. Review the PRs, then set the Ticket to **Done**
from the Ticket or Board card menu.

Settle Threads you are finished with. They stay in the chat's Thread list if you
need them again. Done does not remove worktrees; see
[Manage repositories and worktrees](#manage-repositories-and-worktrees) for cleanup.

## Edit and organize Tickets

Search the Board by Ticket title or a Reference's label or title, and filter by
repository. Search, repository filters, and the selected column are retained per
Workspace. On desktop, drag Tickets between status columns.

Choose **Edit** to change the title or brief. The brief editor formats Markdown
and shows URL or file links as Reference chips. Choose **Markdown** to edit the
source; unsupported formatting stays as editable source. Parts you do not edit
are saved as they were.

Board previews use a separate summary from **Settings → General → Text generation
model**. Regenerate it from the Ticket menu when needed. It does not replace the
brief sent to agents.

Archive a Ticket to hide it from the active Board, or restore it from **Archived**.
Deleting one removes it from Workbench and keeps its native Threads and worktrees.

## Manage repositories and worktrees

Choose **Edit** in **Work area** to change the Ticket's repositories. Use **Add
repository** to add one, and a repository's **⋯** menu to remove it. A
repository cannot be removed while an active Thread works in it. Changes stay marked as Adding or Removing until you choose **Save
changes**; **Cancel** restores the saved choices. Adding repositories to a
prepared work area prepares their worktrees together after saving. **Create
Thread** can only add a repository, for the new Thread; remove repositories in
**Work area**.

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

Worktrees that agents or you add with Git inside the Ticket's workspace directory,
such as one per pull request, show under their repository in **Work area** with
their branch and pull request. They appear when the window regains focus, and
agents see them when they read the Ticket. To remove one, choose its **⋯** menu →
**Remove worktree** and confirm. Its branch and commits stay. Removal is refused
while a Thread works in that worktree or Git reports local changes.

After deleting a Ticket or Workspace, open **Retained worktrees** in the Workbench sidebar to
remove its kept worktrees. Review the listed repository paths, choose **Remove**,
and confirm. The same Thread ownership and local-change checks apply.

## Archive or delete a Workspace

Choose **Archive Workspace** to hide it from the active list and attention
counts. Open **Archived Workspaces** to inspect its Tickets. Archived planning is
read-only; native Threads remain available. **Restore Workspace** resumes
planning and keeps each Ticket's archive state.

Choose **Delete Workspace** and review the Ticket count before confirming.
Deletion permanently removes the Workspace's planning data. Native Projects,
Threads, worktrees, branches, commits, and linked issues remain. There is no undo.
**Retained worktrees** stays available even after deleting the last Workspace.

## Agents and the Ticket

Planning Threads and Threads on a Ticket can read and change their own Ticket or
draft. Agents can change its title, brief, repository scope, and Progress, and
add, remove, or retitle References. Changes apply at once. An agent cannot remove
a repository an active Thread uses. Review brief edits as described in
[Brief, Progress, and requirements](#brief-progress-and-requirements).

Agents record current supporting sources as References and link delivery PRs
through their Threads. When asked, they use their own connectors to research or
create issues. You can also ask a Ticket's agent to create another Thread for
the next PR, choosing a repository on the Ticket.

Each Ticket has an artifacts folder on the machine running the environment,
under `userdata/workbench-artifacts` in the T3 data directory. Agents save plans,
requirements, mockups, and diagrams there and add current sources as References.
Deleting the Ticket or discarding a draft keeps the folder. Keep audit output,
test results, and evidence logs in that folder or the PR.

## Repositories on other machines

A Workspace stays on the machine where you created it. If this client also has
a saved connection to another T3 machine, you can add that machine's Projects to
the Workspace, include them in a Ticket, and use **Link existing Thread** to
attach a Thread that already runs there. Its row shows the Thread's live status
and opens it on that machine.

- Keep at least one Project from the Workspace's own machine. Planning and
  **Start work** run there.
- A Thread on another machine has no Workbench tools and does not see Ticket
  changes, so record its progress on the Ticket yourself. Its work does not move
  the Ticket's status.
- While that machine is not connected, its Threads show **Offline**. You can
  still unlink them.
- File References, the artifacts folder, and prepared worktrees stay on the
  Workspace's machine.
- A repository keeps its place on a Ticket while a linked Thread on another
  machine works in it. Unlink that Thread to remove the repository.
- A Project cannot be added when the Workspace already has a Project with the
  same ID, or when a Project on this machine has it. Copied data can cause this.

## Troubleshooting

| Problem                                           | What to check                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| The agent has not started after creating a Thread | Send a message; creation only prepares the conversation.                    |
| A completed turn leaves the Ticket In Progress    | Review the result and set the Ticket status to Done.                        |
| A repository is missing from a Workspace          | Add its directory as a T3 Project first.                                    |
| A prepared worktree is missing                    | Remove Threads that use it, reset the Ticket work area, then prepare again. |
| A file Reference does not preview as expected     | Select a Thread in the chat; preview support depends on the file format.    |
| Workspaces or Tickets seem to be missing          | Check the connected environment; each has separate records and saved data.  |

For connecting another device, see [Remote access](./remote-access.md).
