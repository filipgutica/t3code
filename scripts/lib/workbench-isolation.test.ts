// @effect-diagnostics nodeBuiltinImport:off - Exercise real source and Git discovery boundaries.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, it } from "@effect/vitest";
import {
  collectWorkbenchImports,
  readRuntimeSources,
  validateWorkbenchIntegrations,
} from "./workbench-isolation.ts";

const fixture = (body: (root: string, write: (file: string, source: string) => void) => void) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-host-boundary-"));
  const write = (file: string, source: string) => {
    const path = NodePath.join(root, file);
    NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
    NodeFS.writeFileSync(path, source);
  };
  try {
    write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "~/*": ["./apps/web/src/*"] } } }),
    );
    write("apps/web/src/workbench/feature.ts", "export const answer = 42;\n");
    body(root, write);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
};

it.each([
  "import { answer } from '../workbench/feature';",
  "import { answer as local } from '~/workbench/feature';",
  "export { answer } from '../workbench/feature';",
  "export * from '../workbench/feature';",
  "const feature = import('../workbench/feature');",
  "const feature = require('../workbench/feature');",
  "import feature = require('../workbench/feature');",
  "import feature = require('~/workbench/feature');",
  "type Feature = import('../workbench/feature');",
])("rejects an unreviewed native dependency: %s", (source) =>
  fixture((root, write) => {
    const file = "apps/web/src/components/native.ts";
    write(file, source);
    const imports = collectWorkbenchImports({ root, sources: readRuntimeSources(root, [file]) });
    assert.equal(imports.length, 1);
    assert.equal(imports[0]?.target, "apps/web/src/workbench/feature");
    assert.include(
      validateWorkbenchIntegrations({ imports, policy: { integrations: [] } }).join("\n"),
      "outside the reviewed host boundary",
    );
  }),
);

it("permits only reviewed symbols at the exact composition site and rejects stale allowances", () =>
  fixture((root, write) => {
    const source = "apps/web/src/root.ts";
    const target = "apps/web/src/workbench/feature";
    const entry = { source, target, symbols: ["answer"], reason: "Install the current overlay" };
    write(source, "import { answer } from './workbench/feature';");
    const imports = collectWorkbenchImports({ root, sources: readRuntimeSources(root, [source]) });
    assert.deepEqual(
      validateWorkbenchIntegrations({ imports, policy: { integrations: [entry] } }),
      [],
    );
    const addedSymbol = imports.map((edge) => ({ ...edge, symbols: [...edge.symbols, "newRule"] }));
    assert.include(
      validateWorkbenchIntegrations({
        imports: addedSymbol,
        policy: { integrations: [entry] },
      }).join("\n"),
      "outside the reviewed host boundary",
    );
    assert.include(
      validateWorkbenchIntegrations({ imports: [], policy: { integrations: [entry] } }).join("\n"),
      "obsolete integration",
    );
  }));

it("detects Workbench schema access through the native contract barrel without banning native contracts", () =>
  fixture((root) => {
    const imports = collectWorkbenchImports({
      root,
      sources: new Map([
        [
          "apps/server/src/native.ts",
          "import { ThreadId, WorkbenchTicketId as Ticket } from '@t3tools/contracts'; type Thread = import('@t3tools/contracts').ThreadId;",
        ],
      ]),
    });
    assert.equal(imports.length, 1);
    assert.deepEqual(imports[0]?.symbols, ["WorkbenchTicketId"]);
  }));

it("detects a qualified Workbench type imported through the contract barrel", () =>
  fixture((root) => {
    const imports = collectWorkbenchImports({
      root,
      sources: new Map([
        [
          "apps/server/src/native.ts",
          "type Ticket = import('@t3tools/contracts').WorkbenchTicketId;",
        ],
      ]),
    });
    assert.deepEqual(imports[0]?.symbols, ["WorkbenchTicketId"]);
  }));

it.each([
  "import * as Contracts from '@t3tools/contracts';",
  "export * from '@t3tools/contracts';",
  "const Contracts = require('@t3tools/contracts');",
  "import Contracts = require('@t3tools/contracts');",
  "const Contracts = import('@t3tools/contracts');",
  "type Contracts = import('@t3tools/contracts');",
])("requires review for wildcard contract access: %s", (content) =>
  fixture((root) => {
    const imports = collectWorkbenchImports({
      root,
      sources: new Map([["apps/server/src/native.ts", content]]),
    });
    assert.deepEqual(imports[0]?.symbols, ["*"]);
    assert.lengthOf(validateWorkbenchIntegrations({ imports, policy: { integrations: [] } }), 1);
  }),
);

it("the CLI rejects untracked native sources instead of relying only on committed files", () =>
  fixture((root, write) => {
    NodeChildProcess.execFileSync("git", ["init", "-q"], { cwd: root });
    write("scripts/workbench-isolation-policy.json", '{"integrations":[]}');
    write("apps/web/src/components/new.ts", "import { answer } from '~/workbench/feature';");
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      [NodePath.resolve(import.meta.dirname, "../workbench-isolation.ts")],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.include(result.stderr, "apps/web/src/components/new.ts:1");
    assert.include(result.stderr, "outside the reviewed host boundary");
  }));
