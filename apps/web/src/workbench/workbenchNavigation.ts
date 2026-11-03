import type { EnvironmentId } from "@t3tools/contracts";

export const withWorkbenchEnvironmentSearch = <Search extends Record<string, unknown>>(
  environmentId: EnvironmentId | null,
  search: Search,
): Search & { readonly environmentId?: EnvironmentId } =>
  environmentId === null ? search : { environmentId, ...search };

/** Only the Board route shows the Workbench sidebar; Thread pages keep the native one. */
export const shouldShowWorkbenchSidebar = (pathname: string) => pathname === "/workbench";
