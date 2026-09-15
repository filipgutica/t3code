#!/usr/bin/env node
// Deterministic Codex executable for the Workbench regression environment.
//
// It implements the small app-server and `codex exec` surfaces used by T3.
// The real provider process is never launched: scenarios are selected from
// CODEX_HOME/workbench-regression.json and thread history is persisted beside
// that control file so a new server process can resume it.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

const VERSION = "workbench-regression-provider/0.1.0";
const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_MESSAGE = "Workbench regression passed.";
const DEFAULT_SUMMARY = "Workbench regression summary.";
const home = process.env.CODEX_HOME?.trim() || NodePath.join(process.cwd(), ".codex");
const controlPath =
  process.env.T3_WORKBENCH_REGRESSION_CONTROL?.trim() ||
  NodePath.join(home, "workbench-regression.json");
const statePath = NodePath.join(home, "workbench-regression-state.json");
const callsPath = NodePath.join(home, "workbench-regression-calls.ndjson");

NodeFS.mkdirSync(home, { recursive: true, mode: 0o700 });

const defaults = {
  turn: { scenario: "success", message: DEFAULT_MESSAGE },
  exec: { scenario: "success", summary: DEFAULT_SUMMARY },
};

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const readControl = () => {
  try {
    const parsed = JSON.parse(NodeFS.readFileSync(controlPath, "utf8"));
    if (!isRecord(parsed)) return defaults;
    return {
      ...defaults,
      ...parsed,
      turn: { ...defaults.turn, ...(isRecord(parsed.turn) ? parsed.turn : {}) },
      exec: { ...defaults.exec, ...(isRecord(parsed.exec) ? parsed.exec : {}) },
    };
  } catch {
    return defaults;
  }
};

const readState = () => {
  try {
    const parsed = JSON.parse(NodeFS.readFileSync(statePath, "utf8"));
    if (isRecord(parsed) && isRecord(parsed.threads)) {
      return {
        nextId: typeof parsed.nextId === "number" ? parsed.nextId : 1,
        threads: parsed.threads,
      };
    }
  } catch {
    // A missing or incomplete fixture state is a fresh demo.
  }
  return { nextId: 1, threads: {} };
};

let state = readState();

const saveState = () => {
  const temporaryPath = `${statePath}.tmp-${process.pid}`;
  NodeFS.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  NodeFS.renameSync(temporaryPath, statePath);
};

const recordCall = (kind, details = {}) => {
  NodeFS.appendFileSync(callsPath, `${JSON.stringify({ kind, ...details })}\n`, { mode: 0o600 });
};

const hash = NodeCrypto.createHash("sha256").update(home).digest("hex").slice(0, 12);
const nextId = (kind) => `${hash}-${kind}-${state.nextId++}`;
const now = () => Math.floor(Date.now() / 1000);

const writeRpc = (message) => {
  if (!process.stdout.destroyed) process.stdout.write(`${JSON.stringify(message)}\n`);
};

const errorResponse = (id, message) => writeRpc({ id, error: { code: -32000, message } });

const modelRecord = (model = DEFAULT_MODEL) => ({
  id: model,
  model,
  displayName: model,
  description: "Deterministic Workbench regression model.",
  hidden: false,
  isDefault: true,
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: [
    { reasoningEffort: "low", description: "Fast regression fixture." },
    { reasoningEffort: "medium", description: "Default regression fixture." },
  ],
  inputModalities: ["text", "image"],
  serviceTiers: [],
});

const threadMeta = ({ id, cwd, model, turns = [], status = { type: "idle" }, updatedAt }) => ({
  id,
  sessionId: id,
  cliVersion: VERSION,
  createdAt: state.threads[id]?.createdAt ?? now(),
  updatedAt: updatedAt ?? now(),
  recencyAt: updatedAt ?? now(),
  cwd,
  modelProvider: "workbench-regression",
  preview: "",
  ephemeral: false,
  historyMode: "legacy",
  source: "appServer",
  path: null,
  forkedFromId: null,
  parentThreadId: null,
  agentNickname: null,
  agentRole: null,
  name: null,
  status,
  turns,
  model,
});

const startResponse = (thread, model, effort) => ({
  thread,
  model,
  modelProvider: "workbench-regression",
  serviceTier: "default",
  cwd: thread.cwd,
  instructionSources: [],
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandbox: { type: "workspaceWrite", writableRoots: [thread.cwd], networkAccess: false },
  reasoningEffort: effort || "medium",
});

const createThread = (params = {}) => {
  const id = nextId("thread");
  const cwd = typeof params.cwd === "string" ? params.cwd : process.cwd();
  const model = typeof params.model === "string" ? params.model : DEFAULT_MODEL;
  const createdAt = now();
  state.threads[id] = { id, cwd, model, createdAt, updatedAt: createdAt, turns: [] };
  saveState();
  return state.threads[id];
};

const materializedThread = (entry, includeTurns, status) =>
  threadMeta({
    id: entry.id,
    cwd: entry.cwd,
    model: entry.model,
    turns: includeTurns ? entry.turns : [],
    status: status ?? { type: "idle" },
    updatedAt: entry.updatedAt,
  });

const userItem = (turnId, input) => ({
  type: "userMessage",
  id: `${turnId}-input`,
  content: [{ type: "text", text: input || "" }],
});

const assistantItem = (turnId, message) => ({
  type: "agentMessage",
  id: `${turnId}-message`,
  text: message,
  phase: "final_answer",
});

let activeTurn;
let pendingApproval;
let releasePoller;

const completeTurn = (scenario, overrideMessage) => {
  if (!activeTurn) return;
  const { entry, turn } = activeTurn;
  if (releasePoller) {
    clearInterval(releasePoller);
    releasePoller = undefined;
  }
  const config = readControl().turn;
  const message =
    typeof overrideMessage === "string"
      ? overrideMessage
      : typeof config.message === "string"
        ? config.message
        : DEFAULT_MESSAGE;
  const successful = scenario === "success" || scenario === "approval";
  const interrupted = scenario === "interrupt" || scenario === "interrupted";
  const item = successful ? assistantItem(turn.id, message) : undefined;
  const items = [userItem(turn.id, turn.input), ...(item ? [item] : [])];
  const completed = {
    ...turn,
    status: successful ? "completed" : interrupted ? "interrupted" : "failed",
    items,
    completedAt: now(),
    durationMs: 1,
    ...(successful || interrupted
      ? {}
      : {
          error: {
            message:
              typeof config.error === "string" ? config.error : "Regression provider failed.",
          },
        }),
  };
  entry.turns = [...entry.turns, completed];
  entry.updatedAt = now();
  saveState();
  if (item) {
    writeRpc({
      jsonrpc: "2.0",
      method: "item/agentMessage/delta",
      params: { threadId: entry.id, turnId: turn.id, itemId: item.id, delta: message },
    });
    writeRpc({
      jsonrpc: "2.0",
      method: "item/completed",
      params: { threadId: entry.id, turnId: turn.id, completedAtMs: Date.now(), item },
    });
  }
  writeRpc({
    jsonrpc: "2.0",
    method: "turn/completed",
    params: { threadId: entry.id, turn: completed },
  });
  writeRpc({
    jsonrpc: "2.0",
    method: "thread/status/changed",
    params: { threadId: entry.id, status: { type: "idle" } },
  });
  activeTurn = undefined;
  pendingApproval = undefined;
};

const beginTurn = (id, params = {}) => {
  const entry = state.threads[params.threadId];
  if (!entry) {
    errorResponse(id, `thread ${String(params.threadId)} not found`);
    return;
  }
  if (activeTurn) {
    errorResponse(id, "a regression turn is already running");
    return;
  }
  const turnId = nextId("turn");
  const turn = {
    id: turnId,
    input:
      Array.isArray(params.input) && typeof params.input[0]?.text === "string"
        ? params.input[0].text
        : "",
    items: [],
    itemsView: "full",
    status: "inProgress",
    startedAt: now(),
    completedAt: null,
    durationMs: null,
  };
  activeTurn = { entry, turn };
  entry.updatedAt = now();
  saveState();
  writeRpc({ id, result: { turn } });
  writeRpc({ jsonrpc: "2.0", method: "turn/started", params: { threadId: entry.id, turn } });
  writeRpc({
    jsonrpc: "2.0",
    method: "thread/status/changed",
    params: { threadId: entry.id, status: { type: "active", activeFlags: [] } },
  });

  const config = readControl().turn;
  const scenario = typeof config.scenario === "string" ? config.scenario : "success";
  recordCall("turn", { scenario, threadId: entry.id, turnId });
  if (scenario === "wait") {
    releasePoller = setInterval(() => {
      const next = readControl().turn;
      if (next.scenario !== "wait")
        completeTurn(next.scenario === "interrupt" ? "interrupt" : next.scenario);
    }, 75);
    releasePoller.unref?.();
    return;
  }
  if (scenario === "approval") {
    const approvalId = `${turnId}-approval`;
    pendingApproval = { approvalId, entry, turn };
    writeRpc({
      jsonrpc: "2.0",
      id: approvalId,
      method: "item/commandExecution/requestApproval",
      params: {
        approvalId,
        itemId: `${turnId}-command`,
        threadId: entry.id,
        turnId,
        command: "echo workbench-regression",
        cwd: entry.cwd,
        startedAtMs: Date.now(),
      },
    });
    return;
  }
  completeTurn(scenario === "failure" ? "failure" : "success");
};

const handleAppServerMessage = (message) => {
  if (!isRecord(message)) return;
  const { id, method, params } = message;
  if (method === undefined && pendingApproval && id === pendingApproval.approvalId) {
    recordCall("approval-response", { id, result: message.result, error: message.error });
    if (message.error || message.result?.decision === "deny") completeTurn("failure");
    else completeTurn("approval");
    return;
  }
  if (method === "initialize") {
    writeRpc({
      id,
      result: {
        userAgent: `workbench-regression/${VERSION}`,
        codexHome: home,
        // This copied executable runs outside the workspace module graph.
        // eslint-disable-next-line t3code/no-global-process-runtime
        platformFamily: process.platform === "win32" ? "windows" : "unix",
        // eslint-disable-next-line t3code/no-global-process-runtime
        platformOs: process.platform,
      },
    });
    return;
  }
  if (method === "account/read") {
    writeRpc({ id, result: { account: { type: "apiKey" }, requiresOpenaiAuth: false } });
    return;
  }
  if (method === "skills/list") {
    writeRpc({ id, result: { data: [] } });
    return;
  }
  if (method === "model/list") {
    const configured = readControl().models;
    const models = Array.isArray(configured) && configured.length ? configured : [modelRecord()];
    writeRpc({ id, result: { data: models, nextCursor: null } });
    return;
  }
  if (method === "account/rateLimits/read") {
    writeRpc({ id, result: { rateLimits: { limitId: "codex", primary: { usedPercent: 0 } } } });
    return;
  }
  if (method === "thread/start") {
    const entry = createThread(params);
    const effort = typeof params?.effort === "string" ? params.effort : "medium";
    writeRpc({
      id,
      result: startResponse(materializedThread(entry, false), entry.model, effort),
    });
    return;
  }
  if (method === "thread/resume") {
    const entry = state.threads[params?.threadId];
    if (!entry) {
      errorResponse(id, `thread ${String(params?.threadId)} not found`);
      return;
    }
    writeRpc({
      id,
      result: startResponse(materializedThread(entry, true), entry.model, "medium"),
    });
    return;
  }
  if (method === "thread/read") {
    const entry = state.threads[params?.threadId];
    if (!entry) {
      errorResponse(id, `thread ${String(params?.threadId)} not found`);
      return;
    }
    writeRpc({ id, result: { thread: materializedThread(entry, params?.includeTurns !== false) } });
    return;
  }
  if (method === "thread/turns/list") {
    const entry = state.threads[params?.threadId];
    if (!entry) {
      errorResponse(id, `thread ${String(params?.threadId)} not found`);
      return;
    }
    writeRpc({ id, result: { data: entry.turns, nextCursor: null } });
    return;
  }
  if (method === "thread/rollback") {
    const entry = state.threads[params?.threadId];
    if (!entry) {
      errorResponse(id, `thread ${String(params?.threadId)} not found`);
      return;
    }
    const count = Number(params?.numTurns);
    entry.turns = Number.isSafeInteger(count)
      ? entry.turns.slice(0, Math.max(0, entry.turns.length - count))
      : entry.turns;
    entry.updatedAt = now();
    saveState();
    writeRpc({ id, result: { thread: materializedThread(entry, true) } });
    return;
  }
  if (
    method === "thread/revert" ||
    method === "thread/compact/start" ||
    method === "config/mcpServer/reload"
  ) {
    writeRpc({ id, result: {} });
    return;
  }
  if (method === "feedback/upload") {
    writeRpc({ id, result: { threadId: params?.threadId ?? "" } });
    return;
  }
  if (method === "turn/start") {
    beginTurn(id, params);
    return;
  }
  if (method === "turn/interrupt") {
    if (activeTurn && activeTurn.entry.id === params?.threadId) completeTurn("interrupt");
    writeRpc({ id, result: {} });
    return;
  }
  if (id !== undefined) writeRpc({ id, result: {} });
};

const runAppServer = async () => {
  recordCall("app-server", { args: process.argv.slice(2) });
  const rl = NodeReadline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    try {
      handleAppServerMessage(JSON.parse(line));
    } catch {
      // The real JSON-RPC process ignores unrelated non-JSON input.
    }
  });
  await new Promise((resolve) => {
    const close = () => {
      if (releasePoller) clearInterval(releasePoller);
      rl.close();
      resolve();
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    process.stdin.once("end", close);
  });
};

const outputFromSchema = (schemaPath, execConfig) => {
  if (isRecord(execConfig.output)) return execConfig.output;
  let schema = {};
  try {
    schema = JSON.parse(NodeFS.readFileSync(schemaPath, "utf8"));
  } catch {
    // The caller will report an invalid output if the output schema is absent.
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const output = {};
  for (const key of Object.keys(properties)) {
    if (key === "summary") output[key] = execConfig.summary || DEFAULT_SUMMARY;
    else if (key === "subject") output[key] = "Workbench regression commit";
    else if (key === "title") output[key] = "Workbench regression";
    else if (key === "body") output[key] = "Generated by the Workbench regression provider.";
    else if (key === "branch") output[key] = "workbench/regression";
    else output[key] = "Workbench regression";
  }
  return output;
};

const runExec = async (args) => {
  const config = readControl().exec;
  recordCall("exec", { scenario: config.scenario, args });
  if (config.scenario === "failure") {
    process.stderr.write(
      `${typeof config.error === "string" ? config.error : "Regression provider failed."}\n`,
    );
    process.exitCode = Number.isSafeInteger(config.exitCode) ? config.exitCode : 17;
    return;
  }
  const outputPathIndex = args.indexOf("--output-last-message");
  const schemaPathIndex = args.indexOf("--output-schema");
  const outputPath = outputPathIndex >= 0 ? args[outputPathIndex + 1] : undefined;
  const schemaPath = schemaPathIndex >= 0 ? args[schemaPathIndex + 1] : undefined;
  if (!outputPath || !schemaPath) {
    process.stderr.write("Regression provider requires output schema and output paths.\n");
    process.exitCode = 2;
    return;
  }
  if (config.scenario === "invalid-output") {
    NodeFS.writeFileSync(outputPath, "not-json\n");
    return;
  }
  const output = outputFromSchema(schemaPath, config);
  NodeFS.writeFileSync(outputPath, `${JSON.stringify(output)}\n`);
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args[0] === "--version" || (args[0] === "version" && args.length === 1)) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (args[0] === "login" && args[1] === "status") {
    process.stdout.write("Logged in\n");
    return;
  }
  if (args[0] === "models") {
    process.stdout.write(`${DEFAULT_MODEL}\n`);
    return;
  }
  if (args[0] === "exec") {
    await runExec(args.slice(1));
    return;
  }
  if (args[0] === "app-server") {
    await runAppServer();
    return;
  }
  process.stderr.write(`Unknown regression provider command: ${args.join(" ")}\n`);
  process.exitCode = 2;
};

await main();
