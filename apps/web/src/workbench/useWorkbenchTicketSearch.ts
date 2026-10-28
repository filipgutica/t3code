import { useEffect, useRef, useState } from "react";
import { useWorkbenchBoardView, type WorkbenchBoardScope } from "./workbenchBoardViewState";

export function matchesWorkbenchTicketSearch({
  title,
  referenceTerms = [],
  query,
}: {
  readonly title: string;
  /** From `getWorkbenchReferenceSearchTerms`. */
  readonly referenceTerms?: ReadonlyArray<string>;
  readonly query: string;
}): boolean {
  const normalized = query.trim().toLowerCase();
  return [title, ...referenceTerms].some((value) => value.toLowerCase().includes(normalized));
}

export function useWorkbenchTicketSearch(scope: WorkbenchBoardScope) {
  const { view, setView, scopeKey } = useWorkbenchBoardView(scope);
  const text = view.searchText;
  const [filter, setFilter] = useState({ scopeKey, query: text.trim() });
  if (filter.scopeKey !== scopeKey) {
    setFilter({ scopeKey, query: text.trim() });
  }
  const timer = useRef<
    { scopeKey: string | null; timeout: ReturnType<typeof setTimeout> } | undefined
  >(undefined);
  useEffect(
    () => () => {
      if (timer.current?.scopeKey === scopeKey) clearTimeout(timer.current.timeout);
    },
    [scopeKey],
  );

  const setText = (value: string) => {
    clearTimeout(timer.current?.timeout);
    setView({ searchText: value });
    const normalized = value.trim();
    if (!normalized) {
      setFilter({ scopeKey, query: "" });
      return;
    }
    timer.current = {
      scopeKey,
      timeout: setTimeout(() => setFilter({ scopeKey, query: normalized }), 200),
    };
  };

  const query = filter.scopeKey === scopeKey ? filter.query : text.trim();
  return { text, query, setText };
}
