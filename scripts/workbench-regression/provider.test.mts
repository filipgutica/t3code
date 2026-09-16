// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - This test drives a disposable provider subprocess.
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeUtil from "node:util";
import { it } from "vite-plus/test";

import {
  configureProvider,
  providerCallsPath,
  providerControlPath,
  providerStatePath,
  REGRESSION_PROVIDER_MESSAGE,
  REGRESSION_PROVIDER_SUMMARY,
} from "./provider-settings.mts";

const providerPath = NodePath.resolve(new URL("./provider.mjs", import.meta.url).pathname);
const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = { readonly [key: string]: JsonValue };

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const objectValue = (value: unknown, label: string): JsonObject => {
  if (!isObject(value)) throw new Error(`Expected ${label} to be an object.`);
  return value;
};

const stringValue = (value: unknown, label: string): string => {
  if (typeof value !== "string") throw new Error(`Expected ${label} to be a string.`);
  return value;
};

const arrayValue = (value: unknown, label: string): readonly JsonValue[] => {
  if (!Array.isArray(value)) throw new Error(`Expected ${label} to be an array.`);
  return value;
};

const property = (value: unknown, key: string, label: string): JsonValue => {
  const result = objectValue(value, label)[key];
  if (result === undefined) throw new Error(`Expected ${label}.${key}.`);
  return result;
};

const stringProperty = (value: unknown, key: string, label: string): string =>
  stringValue(property(value, key, label), `${label}.${key}`);

const objectProperty = (value: unknown, key: string, label: string): JsonObject =>
  objectValue(property(value, key, label), `${label}.${key}`);

const arrayProperty = (value: unknown, key: string, label: string): readonly JsonValue[] =>
  arrayValue(property(value, key, label), `${label}.${key}`);

type RpcMessage = {
  readonly id?: string | number;
  readonly method?: string;
  readonly result?: JsonObject;
  readonly error?: JsonObject;
  readonly params?: JsonObject;
};

class AppServerClient {
  readonly child: NodeChildProcess.ChildProcessWithoutNullStreams;
  readonly responses = new Map<string | number, (message: RpcMessage) => void>();
  readonly notifications: RpcMessage[] = [];
  readonly requests: RpcMessage[] = [];
  readonly waiters: Array<{
    readonly collection: RpcMessage[];
    readonly method: string;
    readonly resolve: (message: RpcMessage) => void;
  }> = [];
  nextRequestId = 1;

  constructor(home: string) {
    this.child = NodeChildProcess.spawn(providerPath, ["app-server"], {
      env: { ...process.env, CODEX_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const rl = NodeReadline.createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      const message = JSON.parse(line) as RpcMessage;
      if (message.method && message.id !== undefined) {
        if (!this.resolveWaiter(this.requests, message.method, message)) {
          this.requests.push(message);
        }
        return;
      }
      if (message.id !== undefined) {
        this.responses.get(message.id)?.(message);
        this.responses.delete(message.id);
        return;
      }
      if (message.method) {
        if (!this.resolveWaiter(this.notifications, message.method, message)) {
          this.notifications.push(message);
        }
      }
    });
  }

  private resolveWaiter(collection: RpcMessage[], method: string, message: RpcMessage): boolean {
    const index = this.waiters.findIndex(
      (waiter) => waiter.collection === collection && waiter.method === method,
    );
    const waiter = index < 0 ? undefined : this.waiters.splice(index, 1)[0];
    waiter?.resolve(message);
    return waiter !== undefined;
  }

  request(method: string, params: unknown): Promise<RpcMessage> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.responses.set(id, (message) => {
        if (message.error) {
          const messageText = message.error.message;
          reject(new Error(typeof messageText === "string" ? messageText : "RPC request failed"));
        } else resolve(message);
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  waitForNotification(method: string): Promise<RpcMessage> {
    const existing = this.notifications.find((message) => message.method === method);
    if (existing) {
      this.notifications.splice(this.notifications.indexOf(existing), 1);
      return Promise.resolve(existing);
    }
    return new Promise((resolve) =>
      this.waiters.push({ collection: this.notifications, method, resolve }),
    );
  }

  waitForRequest(method: string): Promise<RpcMessage> {
    const existing = this.requests.find((message) => message.method === method);
    if (existing) {
      this.requests.splice(this.requests.indexOf(existing), 1);
      return Promise.resolve(existing);
    }
    return new Promise((resolve) =>
      this.waiters.push({ collection: this.requests, method, resolve }),
    );
  }

  close(): Promise<void> {
    this.child.stdin.end();
    return new Promise((resolve) => this.child.once("exit", () => resolve()));
  }
}

const writeControl = (home: string, control: unknown) =>
  NodeFS.writeFileSync(providerControlPath(home), `${JSON.stringify(control, null, 2)}\n`, {
    mode: 0o600,
  });

const makeHome = () =>
  NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-regression-provider-"));

it("answers version and login probes without executing a real provider", async () => {
  const home = makeHome();
  try {
    const version = await execFile(providerPath, ["--version"], {
      env: { ...process.env, CODEX_HOME: home },
    });
    const login = await execFile(providerPath, ["login", "status"], {
      env: { ...process.env, CODEX_HOME: home },
    });
    NodeAssert.match(version.stdout, /workbench-regression-provider\/0\.1\.0/);
    NodeAssert.equal(login.stdout.trim(), "Logged in");
  } finally {
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
});

it("runs a deterministic turn and persists its history for a later process", async () => {
  const home = makeHome();
  await configureProvider(home);
  const first = new AppServerClient(NodePath.join(home, "codex"));
  try {
    await first.request("initialize", {});
    const started = await first.request("thread/start", {
      cwd: "/tmp/regression",
      model: "gpt-5.4-mini",
    });
    const threadId = stringProperty(
      objectProperty(started.result, "thread", "thread/start result"),
      "id",
      "thread/start result.thread",
    );
    const turnStarted = await first.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "run regression" }],
    });
    const turnId = stringProperty(
      objectProperty(turnStarted.result, "turn", "turn/start result"),
      "id",
      "turn/start result.turn",
    );
    NodeAssert.ok(turnId);
    const completed = await first.waitForNotification("turn/completed");
    const completedTurn = objectProperty(completed.params, "turn", "turn/completed params");
    NodeAssert.equal(stringProperty(completedTurn, "status", "completed turn"), "completed");
    const items = arrayProperty(completedTurn, "items", "completed turn");
    const lastItem = objectValue(items.at(-1), "last completed item");
    NodeAssert.equal(
      stringProperty(lastItem, "text", "last completed item"),
      REGRESSION_PROVIDER_MESSAGE,
    );
    await first.close();

    NodeAssert.ok(NodeFS.existsSync(providerStatePath(home)));
    const calls = NodeFS.readFileSync(providerCallsPath(home), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind?: string });
    NodeAssert.ok(calls.some((call) => call.kind === "turn"));
    const second = new AppServerClient(NodePath.join(home, "codex"));
    try {
      await second.request("initialize", {});
      const resumed = await second.request("thread/resume", { threadId, excludeTurns: true });
      const resumedThread = objectProperty(resumed.result, "thread", "thread/resume result");
      NodeAssert.equal(stringProperty(resumedThread, "id", "resumed thread"), threadId);
      NodeAssert.equal(arrayProperty(resumedThread, "turns", "resumed thread").length, 1);
      const read = await second.request("thread/read", { threadId, includeTurns: true });
      const readThread = objectProperty(read.result, "thread", "thread/read result");
      const turns = arrayProperty(readThread, "turns", "read thread");
      const firstTurn = objectValue(turns[0], "read thread first turn");
      const readItems = arrayProperty(firstTurn, "items", "read thread first turn");
      NodeAssert.equal(
        stringProperty(objectValue(readItems.at(-1), "last read item"), "text", "last read item"),
        REGRESSION_PROVIDER_MESSAGE,
      );
    } finally {
      await second.close();
    }
  } finally {
    if (first.child.exitCode === null) await first.close();
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
});

it("supports wait-until-release, interrupt, and approval scenarios", async () => {
  const home = makeHome();
  await configureProvider(home);
  const app = new AppServerClient(NodePath.join(home, "codex"));
  try {
    await app.request("initialize", {});
    const started = await app.request("thread/start", { cwd: "/tmp/regression" });
    const threadId = stringProperty(
      objectProperty(started.result, "thread", "thread/start result"),
      "id",
      "thread/start result.thread",
    );

    writeControl(home, {
      turn: { scenario: "wait", message: REGRESSION_PROVIDER_MESSAGE },
      exec: { scenario: "success", summary: REGRESSION_PROVIDER_SUMMARY },
    });
    await app.request("turn/start", { threadId, input: [{ type: "text", text: "release" }] });
    writeControl(home, {
      turn: { scenario: "success", message: REGRESSION_PROVIDER_MESSAGE },
      exec: { scenario: "success", summary: REGRESSION_PROVIDER_SUMMARY },
    });
    const released = await app.waitForNotification("turn/completed");
    NodeAssert.equal(
      stringProperty(
        objectProperty(released.params, "turn", "released turn params"),
        "status",
        "released turn",
      ),
      "completed",
    );

    writeControl(home, {
      turn: { scenario: "wait", message: REGRESSION_PROVIDER_MESSAGE },
      exec: { scenario: "success", summary: REGRESSION_PROVIDER_SUMMARY },
    });
    const waiting = await app.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "interrupt" }],
    });
    await app.request("turn/interrupt", {
      threadId,
      turnId: stringProperty(
        objectProperty(waiting.result, "turn", "waiting turn/start result"),
        "id",
        "waiting turn",
      ),
    });
    const interrupted = await app.waitForNotification("turn/completed");
    NodeAssert.equal(
      stringProperty(
        objectProperty(interrupted.params, "turn", "interrupted turn params"),
        "status",
        "interrupted turn",
      ),
      "interrupted",
    );

    writeControl(home, {
      turn: { scenario: "approval", message: REGRESSION_PROVIDER_MESSAGE },
      exec: { scenario: "success", summary: REGRESSION_PROVIDER_SUMMARY },
    });
    const approvalTurn = await app.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "approve" }],
    });
    const approval = await app.waitForRequest("item/commandExecution/requestApproval");
    NodeAssert.equal(stringProperty(approval.params, "threadId", "approval params"), threadId);
    app.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: approval.id, result: { decision: "accept" } })}\n`,
    );
    const approved = await app.waitForNotification("turn/completed");
    NodeAssert.equal(
      stringProperty(
        objectProperty(approved.params, "turn", "approved turn params"),
        "status",
        "approved turn",
      ),
      "completed",
    );
    NodeAssert.equal(
      stringProperty(
        objectProperty(approved.params, "turn", "approved turn params"),
        "id",
        "approved turn",
      ),
      stringProperty(
        objectProperty(approvalTurn.result, "turn", "approval turn/start result"),
        "id",
        "approval turn",
      ),
    );
  } finally {
    await app.close();
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
});

it("writes structured exec output and exposes deterministic failure control", async () => {
  const home = makeHome();
  await configureProvider(home);
  const providerHome = NodePath.join(home, "codex");
  const schemaPath = NodePath.join(home, "output-schema.json");
  const outputPath = NodePath.join(home, "output.json");
  NodeFS.writeFileSync(
    schemaPath,
    JSON.stringify({ type: "object", properties: { summary: { type: "string" } } }),
  );
  try {
    const success = await execFile(
      providerPath,
      ["exec", "--output-schema", schemaPath, "--output-last-message", outputPath],
      {
        env: { ...process.env, CODEX_HOME: providerHome },
      },
    );
    NodeAssert.equal(success.stderr, "");
    const output = JSON.parse(NodeFS.readFileSync(outputPath, "utf8")) as unknown;
    NodeAssert.equal(stringProperty(output, "summary", "exec output"), REGRESSION_PROVIDER_SUMMARY);

    writeControl(home, {
      turn: { scenario: "success", message: REGRESSION_PROVIDER_MESSAGE },
      exec: { scenario: "failure", error: "intentional regression failure", exitCode: 23 },
    });
    await NodeAssert.rejects(
      execFile(
        providerPath,
        ["exec", "--output-schema", schemaPath, "--output-last-message", outputPath],
        {
          env: { ...process.env, CODEX_HOME: providerHome },
        },
      ),
      (error: unknown) => {
        if (!(error instanceof Error)) return false;
        const code = Reflect.get(error, "code");
        const stderr = Reflect.get(error, "stderr");
        return (
          code === 23 &&
          typeof stderr === "string" &&
          stderr.includes("intentional regression failure")
        );
      },
    );
  } finally {
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
});
