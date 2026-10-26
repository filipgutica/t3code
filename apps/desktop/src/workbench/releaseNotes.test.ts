import { describe, expect, it } from "vite-plus/test";

import { formatWorkbenchReleaseNotes } from "../../../../scripts/lib/workbench-release-notes.ts";
import { normalizeDesktopUpdateReleaseNotes } from "../updates/releaseNotes.ts";

const version = "0.0.24-nightly.20261019.18";
const previousTag = "workbench-daily-v0.0.24-nightly.20261018.17";
const comparison = `**Full Changelog**: https://github.com/filipgutica/t3code/compare/${previousTag}...workbench-daily-v${version}`;
const options = {
  version,
  signedMacos: true,
  sourceSha: "c8cd082216ac67dd20466e579587c68096961035",
  previousTag,
  upstreamSha: "1451e7cb23034d29774338608368a15d8845df36",
  upstreamBase: "3ff5b3c82a62baddc0c2b1b227e9d3a06190c426",
  dailyMetadata: '{"schemaVersion":1,"channel":"nightly"}',
};

describe("Workbench release notes consumed by the desktop updater", () => {
  it.each([true, false])("shows only the actual change with signedMacos=%s", (signedMacos) => {
    const change =
      "test(workbench): restore upstream-owned test files to upstream by @filipgutica in https://github.com/filipgutica/t3code/pull/169";
    const body = formatWorkbenchReleaseNotes({
      ...options,
      signedMacos,
      generatedNotes: `## What's Changed\n* ${change}\n\n${comparison}`,
    });

    expect(normalizeDesktopUpdateReleaseNotes(body, version, "nightly")).toEqual({
      releaseNotes: [{ version, items: [change], totalItems: 1 }],
      omittedReleaseCount: 0,
    });
    expect(body).toContain(comparison);
    expect(body).toContain(options.sourceSha);
    expect(body).toContain(options.upstreamSha);
    expect(body).toContain(options.upstreamBase);
    expect(body).toContain(`<!-- workbench-daily: ${options.dailyMetadata} -->`);
    expect(body).toContain("Apple installation guidance");
    expect(body).toContain("artifacts were built and checksummed");
    expect(body).toContain(signedMacos ? "signed and notarized macOS builds" : "unsigned preview");
    expect(body.includes("Open Anyway")).toBe(!signedMacos);
  });

  it("counts only changes when the popover truncates a release", () => {
    const body = formatWorkbenchReleaseNotes({
      ...options,
      generatedNotes: [
        "## What's Changed",
        ...Array.from({ length: 9 }, (_, index) => `* Fix ${index + 1}`),
        comparison,
      ].join("\n"),
    });

    expect(normalizeDesktopUpdateReleaseNotes(body, version, "nightly").releaseNotes).toEqual([
      {
        version,
        items: ["Fix 9", "Fix 8", "Fix 7", "Fix 6", "Fix 5", "Fix 4", "Fix 3", "Fix 2"],
        totalItems: 9,
      },
    ]);
  });

  it("retains contributor information outside the change list", () => {
    const contributor = "* @contributor made their first contribution in #169";
    const body = formatWorkbenchReleaseNotes({
      ...options,
      generatedNotes: `## What's Changed\n* Fix update notes\n\n## New Contributors\n${contributor}\n\n${comparison}`,
    });

    expect(normalizeDesktopUpdateReleaseNotes(body, version, "nightly").releaseNotes).toEqual([
      { version, items: ["Fix update notes"], totalItems: 1 },
    ]);
    expect(body).toContain(contributor);
  });

  it.each(["", comparison, `## What's Changed\n\n${comparison}`])(
    "does not invent changes for empty generated notes: %s",
    (generatedNotes) => {
      const body = formatWorkbenchReleaseNotes({ ...options, generatedNotes });

      expect(normalizeDesktopUpdateReleaseNotes(body, version, "nightly").releaseNotes).toEqual([]);
    },
  );

  it("bounds notes without a generated comparison footer for stable releases", () => {
    const body = formatWorkbenchReleaseNotes({
      ...options,
      version: "0.0.24",
      generatedNotes: "## What's Changed\n* Fix update notes",
      dailyMetadata: undefined,
    });

    expect(normalizeDesktopUpdateReleaseNotes(body, "0.0.24", "latest").releaseNotes).toEqual([
      { version: "0.0.24", items: ["Fix update notes"], totalItems: 1 },
    ]);
    expect(body).not.toContain("<!-- workbench-daily:");
  });
});
