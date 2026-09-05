export const parseWorkbenchThreadSearch = (
  search: Record<string, unknown>,
): { workbench?: true } => (search.workbench === true ? { workbench: true } : {});

export const shouldShowWorkbenchSidebar = ({
  pathname,
  search,
  hasTicketContext,
}: {
  pathname: string;
  search: Record<string, unknown>;
  hasTicketContext: boolean;
}) => pathname === "/workbench" || (search.workbench === true && hasTicketContext);
