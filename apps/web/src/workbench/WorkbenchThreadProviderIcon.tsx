import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { MessageSquareIcon } from "lucide-react";

import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import { deriveProviderInstanceEntries, shouldShowInstanceBadge } from "../providerInstances";
import { serverEnvironment } from "../state/server";
import { resolveProviderEntry } from "./WorkbenchSidebarThreadRow.logic";

function ThreadProviderIcon({ shell }: { readonly shell: EnvironmentThreadShell }) {
  const providers = useAtomValue(serverEnvironment.providersValueAtom(shell.environmentId));
  const entries = deriveProviderInstanceEntries(providers ?? []);
  const entry = resolveProviderEntry(shell, entries);
  if (entry === null) return <MessageSquareIcon aria-hidden className="size-3.5" />;
  return (
    <ProviderInstanceIcon
      driverKind={entry.driverKind}
      displayName={entry.displayName}
      accentColor={entry.accentColor}
      acpRegistryAgentId={entry.acpRegistryAgentId}
      acpRegistryIconUrl={entry.acpRegistryIconUrl}
      showBadge={shouldShowInstanceBadge(entry, entries)}
      size="compact"
      iconClassName="opacity-60"
    />
  );
}

/** The Thread's current provider, as native sidebar rows show it; a chat bubble until it loads. */
export function WorkbenchThreadProviderIcon({
  shell,
}: {
  readonly shell: EnvironmentThreadShell | null | undefined;
}) {
  return shell ? (
    <ThreadProviderIcon shell={shell} />
  ) : (
    <MessageSquareIcon aria-hidden className="size-3.5" />
  );
}
