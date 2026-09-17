const isOwned = (path: string) =>
  /^(packages\/workbench\/|apps\/(server|web)\/src\/workbench\/|packages\/contracts\/src\/workbench)/.test(
    path,
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error("Invalid Fallow audit object");
  }
  return value;
};

const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("Invalid Fallow audit list");
  return value;
};

const number = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Invalid Fallow audit number");
  }
  return value;
};

const text = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Invalid Fallow audit path");
  return value;
};

const introduced = (value: unknown): boolean => {
  if (typeof value !== "boolean") throw new Error("Missing Fallow new-only attribution");
  return value;
};

// Use zero-context hunks so an unrelated upstream clone cannot make an existing
// Workbench clone fail merely because its file has another edit elsewhere.
const changedLines = (diff: string) => {
  const files = new Map<string, Array<{ start: number; end: number }>>();
  let path = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) path = line.slice(6);
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk || !isOwned(path)) continue;
    const start = Number(hunk[1]);
    const count = Number(hunk[2] ?? 1);
    if (count === 0) continue;
    const ranges = files.get(path) ?? [];
    ranges.push({ start, end: start + count - 1 });
    files.set(path, ranges);
  }
  return files;
};

export const evaluateWorkbenchQuality = ({ report, diff }: { report: unknown; diff: string }) => {
  const audit = record(report);
  const findings = list(record(audit.complexity).findings);
  const clones = list(record(audit.duplication).clone_groups);
  const changed = changedLines(diff);
  const failures: string[] = [];

  for (const value of findings) {
    const finding = record(value);
    const path = text(finding.path);
    const cyclomatic = number(finding.cyclomatic);
    const cognitive = number(finding.cognitive);
    if (
      introduced(finding.introduced) &&
      changed.has(path) &&
      (cyclomatic > 20 || cognitive > 15)
    ) {
      failures.push(
        `${path}:${number(finding.line)}: complexity ${cyclomatic}/20, cognitive ${cognitive}/15`,
      );
    }
  }

  for (const value of clones) {
    const clone = record(value);
    const isNew = introduced(clone.introduced);
    for (const value of list(clone.instances)) {
      const instance = record(value);
      const path = text(instance.file);
      const start = number(instance.start_line);
      const end = number(instance.end_line);
      if (isNew && changed.get(path)?.some((range) => start <= range.end && end >= range.start)) {
        failures.push(
          `${path}:${start}: new duplicated block (${number(clone.token_count)} tokens)`,
        );
        break;
      }
    }
  }
  return failures;
};
