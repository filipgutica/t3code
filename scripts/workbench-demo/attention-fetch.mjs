// Demo-only Node preload. Native FetchHttpClient reads global fetch at request execution.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const home = process.env.T3CODE_SYNTHETIC_ATTENTION_HOME;
const uid = process.getuid?.();
const requireOwned = (path, directory = false) => {
  const entry = NodeFS.lstatSync(path);
  if (
    entry.isSymbolicLink() ||
    (directory ? !entry.isDirectory() : !entry.isFile()) ||
    (uid !== undefined && entry.uid !== uid)
  )
    throw new Error("Synthetic attention transport requires its owned demo home.");
};
if (!home || !NodePath.isAbsolute(home) || NodeFS.realpathSync(home) !== home)
  throw new Error("Synthetic attention transport requires its owned demo home.");
requireOwned(home, true);
const markerPath = NodePath.join(home, ".synthetic-attention-transport.json");
requireOwned(markerPath);
const marker = JSON.parse(NodeFS.readFileSync(markerPath, "utf8"));
if (
  marker.kind !== "synthetic-attention-transport" ||
  marker.version !== 1 ||
  marker.home !== home ||
  !Array.isArray(marker.queries) ||
  !marker.queries.every(
    (query) => typeof query === "string" && /^query\b/.test(query) && !/\bmutation\b/.test(query),
  )
)
  throw new Error("Unsupported synthetic attention transport ownership marker.");

const queries = new Set(marker.queries);
const originalFetch = globalThis.fetch;
const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const adapter = NodePath.join(import.meta.dirname, "gh-attention.mjs");
const headers = {
  "Content-Type": "application/json",
  "X-RateLimit-Limit": "5000",
  "X-RateLimit-Remaining": "4999",
  "X-RateLimit-Reset": "4070908800",
};
const refuse = () =>
  Response.json(
    {
      message:
        "[Synthetic demo] Request is outside the read-only fixture allowlist; no GitHub request was sent.",
    },
    { status: 403, headers },
  );

globalThis.fetch = async (input, init) => {
  let url;
  try {
    url = new URL(input instanceof Request ? input.url : input);
  } catch {
    return originalFetch(input, init);
  }
  if (url.hostname.toLowerCase().replace(/\.$/, "") !== "api.github.com")
    return originalFetch(input, init);
  // Every GitHub request terminates here, regardless of ambient authorization headers.
  try {
    const request = new Request(input, init);
    if (request.signal.aborted) throw request.signal.reason;
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return refuse();
    let args;
    let document;
    if (url.pathname === "/graphql" && request.method === "POST") {
      document = await request.json();
      if (!document || !queries.has(document.query) || /\bmutation\b/.test(document.query))
        return refuse();
      args = ["api", "graphql", "--hostname", "github.com", "--input", "-"];
    } else if (request.method === "GET" && ["/user", "/rate_limit"].includes(url.pathname)) {
      args = ["api", url.pathname.slice(1), "--hostname", "github.com"];
    } else return refuse();
    const execution = execFile(process.execPath, [adapter, ...args], {
      signal: request.signal,
      timeout: 10_000,
      maxBuffer: 1_048_576,
      // The fixture executable owns no HTTP requests and needs no inherited preloads or auth.
      env: { PATH: process.env.PATH },
    });
    if (document !== undefined) execution.child.stdin?.end(JSON.stringify(document));
    const { stdout } = await execution;
    return new Response(stdout, { status: 200, headers });
  } catch (error) {
    if (init?.signal?.aborted || (input instanceof Request && input.signal.aborted)) throw error;
    return refuse();
  }
};
