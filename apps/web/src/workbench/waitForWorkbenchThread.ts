import type { ScopedThreadRef } from "@t3tools/contracts";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentThreadShells } from "../state/threads";

/** The native route treats an absent shell as missing, even after creation succeeds. */
export function waitForWorkbenchThread(threadRef: ScopedThreadRef): Promise<void> {
  const shellAtom = environmentThreadShells.threadShellAtom(threadRef);
  if (appAtomRegistry.get(shellAtom) !== null) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const timeout = setTimeout(() => {
      settled = true;
      unsubscribe?.();
      reject(
        new Error(
          "The Ticket Thread was created, but has not appeared in this client. Try opening it again.",
        ),
      );
    }, 10_000);
    const finish = () => {
      if (settled || appAtomRegistry.get(shellAtom) === null) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve();
    };
    unsubscribe = appAtomRegistry.subscribe(shellAtom, finish);
    // Recheck after subscribing so an update between the read and subscription is not lost.
    finish();
    if (settled) unsubscribe();
  });
}
