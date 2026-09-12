declare const __T3CODE_BUILD_WORKBENCH_JIRA_BROKER_URL__: string | undefined;

function normalizeBrokerUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

const buildBrokerUrl =
  typeof __T3CODE_BUILD_WORKBENCH_JIRA_BROKER_URL__ === "undefined"
    ? ""
    : (normalizeBrokerUrl(__T3CODE_BUILD_WORKBENCH_JIRA_BROKER_URL__) ?? "");

/** Resolve the public Jira OAuth broker URL embedded in production builds. */
export const resolveWorkbenchJiraBrokerUrl = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | null =>
  normalizeBrokerUrl(environment.T3_WORKBENCH_JIRA_BROKER_URL?.trim() ?? "") ??
  (buildBrokerUrl || null);
