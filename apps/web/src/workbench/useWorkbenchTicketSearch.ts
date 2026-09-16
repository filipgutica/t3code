import { useCallback, useEffect, useRef, useState } from "react";

export function matchesWorkbenchTicketSearch({
  title,
  jiraKey,
  query,
}: {
  readonly title: string;
  readonly jiraKey?: string | undefined;
  readonly query: string;
}): boolean {
  const normalized = query.trim().toLowerCase();
  return (
    title.toLowerCase().includes(normalized) ||
    (jiraKey?.toLowerCase().includes(normalized) ?? false)
  );
}

export function useWorkbenchTicketSearch() {
  const [text, setInputText] = useState("");
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const setText = useCallback((value: string) => {
    clearTimeout(timer.current);
    setInputText(value);
    const normalized = value.trim();
    if (!normalized) {
      setQuery("");
      return;
    }
    timer.current = setTimeout(() => setQuery(normalized), 200);
  }, []);

  return { text, query, setText };
}
