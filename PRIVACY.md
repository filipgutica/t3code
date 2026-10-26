# T3 Code Workbench Privacy Policy

**Operator:** Filip Gutica  
**Privacy contact:** [t3code-workbench@proton.me](mailto:t3code-workbench@proton.me)  
**Effective date:** September 16, 2026

## Scope

This policy describes how T3 Code Workbench handles information when you use this
fork and the hosted Jira authorization service used by earlier releases.
Workbench is an independently
maintained fork of T3 Code. This policy does not represent T3 Tools, Inc.,
Atlassian, GitHub, Cloudflare, or your AI provider.

Workbench organizes projects, Tickets, Epics, repository worktrees, coding-agent
Threads, linked pull requests, and linked Jira issues. It can send task context
to providers you configure.

## Where your information goes

Your T3 environment is the computer or server running your T3 backend. It may be
your own computer or a remote machine managed by someone else. Workbench stores
its project data and conversation history in that environment. Browser clients
also use local storage for settings and application state.

Current releases do not connect to Jira. Earlier releases that connect to Jira
use a hosted authorization service. It handles authorization and token refresh
and does not receive your project database, repository files, Jira issue
content, or conversations. Those releases request Jira content directly from
Atlassian.

This does not mean all information stays on your device. Connected integrations,
AI providers, remote environments, and optional connectivity services receive
information needed for the features you use.

## Information processed and its purpose

### Projects, repositories, and conversations

Workbench and the underlying T3 application process project names, repository
paths, branches, worktrees, Ticket and Epic content, prompts, attachments, agent
responses, tool results, and execution history. This information supports task
planning, agent execution, navigation, summaries, and retained work history.

Providers can access repository content and tools according to their configuration
and permissions. Remote-environment administrators may also have access to data
stored on their machines.

### Jira

Workbench stores the Jira issue key and URL that you link to a Ticket or Epic
and includes them in Ticket context sent to your agent. It does not sign in to
Jira or read or change Jira content. Coding agents can use their own Jira
connectors, subject to the provider's configuration and your Jira permissions.

If you connected Jira in an earlier release, Tickets and Epics imported then
keep their stored titles, descriptions, statuses, and issue links. That
release's Jira credentials remain in your environment's secret store; updating
Workbench does not delete them. This content may contain personal or
confidential information entered into Jira.

### Hosted Jira authorization service

Earlier releases that connect to Jira use this service; current releases do
not. The authorization service runs on Cloudflare. It processes authorization codes,
temporary session identifiers, access and refresh tokens, token expiry, and
granted scopes to connect your environment to Atlassian.

Authorization results are encrypted while temporarily stored for collection by
the originating environment. Sessions expire five minutes after creation. The
service removes the result when it is claimed and schedules expired session
storage for deletion. Expiry prevents further access even if cleanup is delayed.

Your environment retains its credentials in its T3 secret store. Token refresh
passes the refresh token through the hosted service to Atlassian and returns new
credentials to your environment. The refresh endpoint does not save those
credentials in a persistent token database.

Cloudflare processes network information, including IP addresses. The service
uses IP addresses for rate limiting and abuse protection. The repository's
service configuration disables Workers observability; this is not a guarantee
that Cloudflare retains no platform or security records.

### AI providers and generated summaries

When you send a message, task context and other selected content can be sent to
your configured coding-agent or AI provider. Workbench can also automatically
send Ticket titles and descriptions to the configured text-generation provider
to create or refresh summaries. This can include content that an earlier release
imported from Jira, even when you have not sent that content in a chat message.

Provider retention, model training, and account controls depend on that provider
and your agreement with it. This policy makes no promise that third-party
providers exclude your content from training.

### GitHub, connectivity, and diagnostics

Git and GitHub features communicate with configured repository hosts to support
repository operations and pull-request information. Information you publish,
such as commits and pull requests, is visible according to the destination's
access settings.

If you use optional T3 Connect, relay, tunnel, hosted-client, or other remote
services, those services also process connection information under their own
policies. The Workbench Jira authorization service is separate from T3 Connect.

T3 environments can produce local operational logs. Builds or environments
configured for remote diagnostic tracing can transmit diagnostic information
to their configured service. Do not assume every build has identical diagnostic
settings.

## Sharing and use

We use information handled by our hosted service to provide Jira authorization
for earlier releases, refresh access, protect the service, and respond to support requests. We do not
sell personal information or use Jira content for advertising.

Information is shared with the services needed for your selected features,
including Atlassian, Cloudflare, GitHub or other repository hosts, and configured
AI providers. We may disclose information we hold when legally required.

Third-party services may process information in countries other than your own.
The location of project data also depends on where your T3 environment runs.

## Retention and deletion

Local project data, imported Jira content, generated summaries, and Thread
history do not have a general 24-hour expiry. They can remain in your environment
until removed. Archiving work or revoking Jira access does not by itself erase existing local copies, conversation history, or backups.

You can revoke this app's authorization through your Atlassian account. This
withdraws its authorization; it does not delete content already copied elsewhere.
Use Workbench's available deletion controls and contact your environment
administrator for remaining stored data or backups. Removing local records does
not necessarily remove corresponding Jira issues or content published to GitHub.

The hosted authorization session retention is described above. Retention by AI
providers, repository hosts, remote-environment operators, and other services
follows their policies and your settings.

We delete support emails from our mailbox within 90 days after the request is resolved, unless
continued retention is required by law. Proton processes these messages as our
email provider under its own privacy and retention practices.

The hosted authorization service uses Cloudflare SQLite-backed Durable Objects. Cloudflare provides
[point-in-time recovery for the preceding 30 days](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
Deleting an active authorization session is therefore not a promise of immediate
erasure from all infrastructure recovery storage. Platform security records and
recovery copies are subject to Cloudflare's retention practices.

## Your choices and privacy requests

You choose which Jira issues to link, which repositories to use, and which
providers and connectors receive your work. Review your provider configuration
before adding sensitive content, because
summary generation can transmit Ticket content automatically.

Contact the privacy address above to ask about information held by the operator
or request access, correction, or deletion. Applicable rights depend on your
location. We may need to verify your identity before handling a request. We
cannot directly erase data held only in an environment you or another operator
controls, or in an independent provider's systems.

Do not post credentials, private Jira content, or personal deletion requests in
public GitHub issues. Contact the operator privately.

## Changes

We will update this policy when relevant data practices change and revise its
effective date. Review the current policy before enabling new integrations or
services.
