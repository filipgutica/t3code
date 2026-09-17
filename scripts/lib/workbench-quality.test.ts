import { expect, it } from "vite-plus/test";
import { evaluateWorkbenchQuality } from "./workbench-quality";

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

it("allows the complexity limits and fails either newly exceeded limit", () => {
  expect(evaluateWorkbenchQuality({ report: report([finding()]), diff })).toEqual([]);
  for (const violation of [{ cyclomatic: 21 }, { cognitive: 16 }]) {
    expect(evaluateWorkbenchQuality({ report: report([finding(violation)]), diff })).toHaveLength(
      1,
    );
  }
});

it("keeps inherited complexity and unrelated upstream findings out of the gate", () => {
  const findings = [
    finding({ cyclomatic: 50, introduced: false }),
    finding({ path: upstream, cyclomatic: 50 }),
  ];
  expect(
    evaluateWorkbenchQuality({ report: { ...report(findings), verdict: "fail" }, diff }),
  ).toEqual([]);
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

it("covers each Workbench owner without including adjacent upstream directories", () => {
  for (const path of [
    "packages/workbench/src/test.ts",
    "apps/server/src/workbench/test.ts",
    owned,
    "packages/contracts/src/workbenchRpc.ts",
  ]) {
    expect(
      evaluateWorkbenchQuality({
        report: report([finding({ path, cyclomatic: 21 })]),
        diff: diff.replaceAll(owned, path),
      }),
    ).toHaveLength(1);
  }
  expect(
    evaluateWorkbenchQuality({
      report: report([finding({ path: upstream, cyclomatic: 21 })]),
      diff: diff.replaceAll(owned, upstream),
    }),
  ).toEqual([]);
});

it("fails closed on missing or malformed analysis and attribution", () => {
  for (const invalid of [
    {},
    report([finding({ introduced: undefined })]),
    report([finding({ cyclomatic: "21" })]),
  ]) {
    expect(() => evaluateWorkbenchQuality({ report: invalid, diff })).toThrow();
  }
});
