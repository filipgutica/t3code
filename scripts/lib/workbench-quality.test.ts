import { expect, it } from "vite-plus/test";
import { evaluateWorkbenchComplexity, evaluateWorkbenchQuality } from "./workbench-quality.ts";

const owned = "apps/web/src/workbench/Example.ts";
const upstream = "apps/web/src/components/Example.ts";
const diff = `diff --git a/${owned} b/${owned}\n--- a/${owned}\n+++ b/${owned}\n@@ -9,0 +10,5 @@\n+new code\n`;
const finding = (overrides = {}) => ({
  path: owned,
  line: 10,
  cyclomatic: 20,
  cognitive: 15,
  introduced: true,
  ...overrides,
});
const clone = (overrides = {}) => ({
  introduced: true,
  token_count: 75,
  instances: [
    { file: owned, start_line: 10, end_line: 15 },
    { file: upstream, start_line: 1, end_line: 6 },
  ],
  ...overrides,
});
const report = (findings: unknown[] = [], clone_groups: unknown[] = []) => ({
  complexity: { findings },
  duplication: { clone_groups },
});

const health = (findings: unknown[] = []) => ({
  kind: "health",
  summary: { files_analyzed: 1, functions_analyzed: 1 },
  findings,
});

it("allows the limits and rejects existing violations without a changed file", () => {
  expect(evaluateWorkbenchComplexity(health([finding()]))).toEqual([]);
  for (const violation of [{ cyclomatic: 21 }, { cognitive: 16 }]) {
    expect(
      evaluateWorkbenchComplexity(health([finding({ ...violation, introduced: false })])),
    ).toHaveLength(1);
  }
});

it("keeps upstream production and Workbench test fixtures out of the complexity gate", () => {
  for (const path of [
    upstream,
    "apps/web/src/workbench/Example.test.tsx",
    "packages/workbench/src/fixtures/example.ts",
    "infra/workbench-auth/test/session.test.ts",
  ]) {
    expect(evaluateWorkbenchComplexity(health([finding({ path, cyclomatic: 50 })]))).toEqual([]);
  }
});

it("fails a new clone touching Workbench even when native audit only warns", () => {
  expect(
    evaluateWorkbenchQuality({ report: { ...report([], [clone()]), verdict: "warn" }, diff }),
  ).toHaveLength(1);
});

it("excludes inherited clones and clones outside changed Workbench lines", () => {
  const clones = [
    clone({ introduced: false }),
    clone({ instances: [{ file: upstream, start_line: 10, end_line: 15 }] }),
    clone({ instances: [{ file: owned, start_line: 20, end_line: 25 }] }),
  ];
  expect(evaluateWorkbenchQuality({ report: report([], clones), diff })).toEqual([]);
});

it("covers every shipped Workbench owner including extracted helpers and auth", () => {
  for (const path of [
    "packages/workbench/src/test.ts",
    "apps/server/src/workbench/test.ts",
    owned,
    "apps/web/src/workbench/extracted/helper.ts",
    "packages/contracts/src/workbenchRpc.ts",
    "apps/web/src/routes/workbench.tsx",
    "apps/desktop/src/workbench/updates.ts",
    "apps/mobile/src/workbench/helper.ts",
    "infra/workbench-auth/src/session.ts",
  ]) {
    expect(evaluateWorkbenchComplexity(health([finding({ path, cognitive: 16 })]))).toHaveLength(1);
  }
});

it("fails closed on missing or malformed complexity analysis", () => {
  for (const invalid of [
    {},
    { ...health(), kind: "audit" },
    { ...health(), summary: { files_analyzed: 0, functions_analyzed: 0 } },
    { ...health(), findings: null },
    health([finding({ cyclomatic: "21" })]),
  ]) {
    expect(() => evaluateWorkbenchComplexity(invalid)).toThrow();
  }
});

it("fails closed on missing duplication analysis and attribution", () => {
  for (const invalid of [{}, report([], [clone({ introduced: undefined })])]) {
    expect(() => evaluateWorkbenchQuality({ report: invalid, diff })).toThrow();
  }
});
