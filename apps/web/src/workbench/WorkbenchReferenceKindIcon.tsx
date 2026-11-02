import type { WorkbenchReferenceKind } from "@t3tools/contracts";
import { CircleDotIcon, FileTextIcon, GithubIcon, LinkIcon } from "lucide-react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { WorkbenchJiraIcon } from "./WorkbenchJiraIcon";

const KIND_ICONS = {
  jira_issue: WorkbenchJiraIcon,
  github_issue: CircleDotIcon,
  github_pull_request: PullRequestGlyph.pullRequest,
  file: FileTextIcon,
  link: LinkIcon,
} satisfies Record<WorkbenchReferenceKind, unknown>;

const isGitHubUrl = (url: string) =>
  URL.canParse(url) && /^(?:www\.)?github\.com$/u.test(new URL(url).hostname);

/** With a `url`, any github.com Reference shows the GitHub mark, as in References and chips. */
export function WorkbenchReferenceKindIcon({
  kind,
  url,
  className,
}: {
  readonly kind: WorkbenchReferenceKind;
  readonly url?: string;
  readonly className?: string;
}) {
  const Icon = url !== undefined && isGitHubUrl(url) ? GithubIcon : KIND_ICONS[kind];
  return <Icon aria-hidden className={className} />;
}
