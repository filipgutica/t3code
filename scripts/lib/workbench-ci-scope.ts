// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

// A pattern ending in "/" or "-", or with no extension, selects every path it prefixes.
export const matchesScopePattern = (path: string, pattern: string) =>
  pattern.endsWith("/") || pattern.endsWith("-") || !NodePath.extname(pattern)
    ? path.startsWith(pattern)
    : path === pattern;
