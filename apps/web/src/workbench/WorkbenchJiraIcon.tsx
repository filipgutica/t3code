import type { SVGProps } from "react";

/** A small fork-owned Jira mark for Workbench's mirrored issue indicators. */
export function WorkbenchJiraIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} aria-hidden="true" fill="currentColor" focusable="false" viewBox="0 0 24 24">
      <path d="M12 3c0 2.761 2.239 5 5 5h4v4h-4c-4.971 0-9-4.029-9-9h4Z" />
      <path d="M12 21c0-2.761-2.239-5-5-5H3v-4h4c4.971 0 9 4.029 9 9h-4Z" />
    </svg>
  );
}
