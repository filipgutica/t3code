import { CommandId, ThreadId } from "../../packages/contracts/src/baseSchemas.ts";
import { runRpc, dispatch, readShellSnapshot } from "./local.mts";

export const linkDemoPullRequests = async ({
  wsUrl,
  token,
  urls,
}: {
  wsUrl: string;
  token: string;
  urls: readonly string[];
}) => {
  for (const [index, value] of urls.entries()) {
    const url = new URL(value);
    const match = /^\/([^/]+\/[^/]+)\/pull\/(\d+)$/.exec(url.pathname);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || !match?.[1] || !match[2])
      throw new Error("Expected a GitHub pull request URL.");
    const repository = match[1];
    const number = Number(match[2]);
    await runRpc(wsUrl, token, (client) =>
      dispatch(client, {
        type: "thread.pull-request.link",
        commandId: CommandId.make(`demo-pr-${repository}-${number}`),
        threadId: ThreadId.make(index % 2 === 0 ? "orbit-001-thread" : "orbit-005-thread"),
        host: "github.com",
        repository,
        number,
        url: value,
        source: "manual",
      }),
    );
  }
  return await verifyDemoPullRequests({ wsUrl, token, urls });
};

export const verifyDemoPullRequests = async ({
  wsUrl,
  token,
  urls,
}: {
  wsUrl: string;
  token: string;
  urls: readonly string[];
}) => {
  const shell = await readShellSnapshot(wsUrl, token);
  const linked = new Set(
    shell.threads
      .filter((thread) => ["orbit-001-thread", "orbit-005-thread"].includes(thread.id))
      .flatMap((thread) => (thread.pullRequests ?? []).map((pr) => pr.url)),
  );
  if (urls.some((url) => !linked.has(url)))
    throw new Error("Not all selected PRs were linked to native demo Threads.");
  return urls.length;
};
