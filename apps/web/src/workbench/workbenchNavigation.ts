import type { EnvironmentId } from "@t3tools/contracts";

export const parseWorkbenchThreadSearch = (
  search: Record<string, unknown>,
): { workbench?: true } => (search.workbench === true ? { workbench: true } : {});

export const withWorkbenchEnvironmentSearch = <Search extends Record<string, unknown>>(
  environmentId: EnvironmentId | null,
  search: Search,
): Search & { readonly environmentId?: EnvironmentId } =>
  environmentId === null ? search : { environmentId, ...search };

export const shouldShowWorkbenchSidebar = ({
  pathname,
  search,
  hasTicketContext,
}: {
  pathname: string;
  search: Record<string, unknown>;
  hasTicketContext: boolean;
}) => pathname === "/workbench" || (search.workbench === true && hasTicketContext);
