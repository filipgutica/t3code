// Upstream c5bc98d integrates the V2 compatibility generation (0.0.46).
// Workbench release versions evolve independently; reassess this package metadata
// when syncing upstream provider adapters or compatibility policies.
export const resolveUpstreamProviderCompatibilityVersion = ({
  version,
  workbench,
}: {
  version: string;
  workbench?: { upstreamProviderCompatibilityVersion?: string };
}) => workbench?.upstreamProviderCompatibilityVersion ?? version;
