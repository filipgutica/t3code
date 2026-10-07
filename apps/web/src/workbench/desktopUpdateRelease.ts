const RELEASE_HISTORY_URL = "https://github.com/filipgutica/t3code/releases";

export function getWorkbenchDesktopUpdateReleaseUrl(version: string): string {
  const prefix = /-nightly\.\d{8}\.\d+$/.test(version) ? "workbench-daily-v" : "workbench-v";
  return `${RELEASE_HISTORY_URL}/tag/${prefix}${encodeURIComponent(version)}`;
}

export function getWorkbenchDesktopUpdateReleaseHistoryUrl(): string {
  return RELEASE_HISTORY_URL;
}
