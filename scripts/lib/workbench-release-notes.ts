export function formatWorkbenchReleaseNotes({
  version,
  generatedNotes,
  signedMacos,
  sourceSha,
  previousTag,
  upstreamSha,
  upstreamBase,
  dailyMetadata,
}: {
  readonly version: string;
  readonly generatedNotes: string;
  readonly signedMacos: boolean;
  readonly sourceSha: string;
  readonly previousTag: string;
  readonly upstreamSha: string;
  readonly upstreamBase: string;
  readonly dailyMetadata: string | undefined;
}): string {
  const lines = generatedNotes.trim().split(/\r?\n/);
  const footerStart = lines.findIndex((line) =>
    /^(?:#{1,6}\s+(?:New Contributors|Full Changelog)\s*$|\*\*Full Changelog\*\*:)/i.test(line),
  );
  const changes = (footerStart === -1 ? lines : lines.slice(0, footerStart)).join("\n").trim();
  const footer = footerStart === -1 ? [] : lines.slice(footerStart);
  const comparison = footer.filter((line) => /^\*\*Full Changelog\*\*:/i.test(line));
  const contributors = footer
    .filter((line) => !/^(?:#{1,6}\s+Full Changelog\s*$|\*\*Full Changelog\*\*:)/i.test(line))
    .join("\n")
    .trim();

  // Installed clients stop at this heading; prose before it is counted as a change.
  return (
    [
      `# T3 Code Workbench ${version}`,
      changes,
      "## Full Changelog",
      comparison.join("\n"),
      contributors,
      "## Installation",
      signedMacos
        ? "This release has signed and notarized macOS builds. Windows and Linux builds are unsigned."
        : "This is an unsigned preview of T3 Code Workbench.",
      "Install Workbench alongside official T3 Code. It uses separate saved data. Windows and Linux AppImage builds check published Workbench releases automatically; choose when to download and restart. Signed macOS builds also support updates; unsigned macOS builds require manual downloads. Existing unsigned macOS installations and version 0.0.1 need a manual upgrade to this release to enable updates.",
      ...(signedMacos
        ? []
        : ["macOS may require System Settings → Privacy & Security → Open Anyway."]),
      "Windows may show an unknown-publisher or SmartScreen warning; device policies can block unsigned apps. On Linux, make the AppImage executable.",
      "See [Apple installation guidance](https://support.apple.com/en-ca/guide/mac-help/mh40616/mac) and [Windows signing guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).",
      "## Build provenance",
      [
        `- Selected fork \`main\` commit: \`${sourceSha}\``,
        `- Previous tag used for generated notes: \`${previousTag || "none"}\``,
        `- Upstream \`pingdotgg/t3code\` main: \`${upstreamSha || "unavailable"}\``,
        `- Upstream merge base: \`${upstreamBase || "unavailable"}\``,
      ].join("\n"),
      "## Verification",
      "- macOS arm64 and x64, Linux x64, and Windows x64 artifacts were built and checksummed.\n- See the platform build metadata for signing status.",
      ...(dailyMetadata === undefined ? [] : [`<!-- workbench-daily: ${dailyMetadata} -->`]),
    ].join("\n\n") + "\n"
  );
}
