import type { ReactNode } from "react";

import { DEFAULT_LOCALE } from "../i18n/locales";

/**
 * gt-react for Node unit tests, where GT can't initialize: copy renders as its English source.
 * The resolvers stay stable across renders, as GT's do, so hooks keyed on them settle.
 * `decodeMsg` cuts a plain string at its first colon; resolve only `msg()` values through it.
 */
// fallow-ignore-next-line unused-export -- vi.mock factories load it through dynamic import
export function englishGtReact(actual: typeof import("gt-react")) {
  const english = (text: string, values: Record<string, unknown> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]));
  return {
    ...actual,
    useGT: () => english,
    useMessages: () => actual.decodeMsg,
    useLocale: () => DEFAULT_LOCALE,
    T: ({ children }: { children: ReactNode }) => children,
    Var: ({ children }: { children: ReactNode }) => children,
  };
}
