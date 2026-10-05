// @effect-diagnostics nodeBuiltinImport:off - Exercise setup through the real Node process and filesystem.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, it } from "@effect/vitest";

const envFiles = [".env", NodePath.join("infra", "relay", ".env")];

it.each(["real file", "directory", "missing", "broken symlink", "main checkout", "symlink source"])(
  "setup preserves env files and only replaces links: %s",
  (scenario) => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-setup-env-"));
    const project = NodePath.join(root, "project");
    const checkout = scenario === "main checkout" ? project : NodePath.join(root, "checkout");
    const bin = NodePath.join(root, "bin");
    try {
      for (const directory of [project, checkout, bin]) {
        NodeFS.mkdirSync(NodePath.join(directory, "infra", "relay"), { recursive: true });
      }
      NodeFS.mkdirSync(NodePath.join(checkout, "scripts"), { recursive: true });
      NodeFS.copyFileSync(
        NodePath.join(import.meta.dirname, "setup-worktree.ts"),
        NodePath.join(checkout, "scripts", "setup-worktree.ts"),
      );
      const warmScript = NodePath.join(checkout, "apps", "web", "scripts", "warm-dep-cache.ts");
      NodeFS.mkdirSync(NodePath.dirname(warmScript), { recursive: true });
      NodeFS.writeFileSync(warmScript, "process.exit(0);\n");
      NodeFS.writeFileSync(
        NodePath.join(bin, process.platform === "win32" ? "vp.cmd" : "vp"),
        process.platform === "win32" ? "@exit /b 0\r\n" : "#!/bin/sh\nexit 0\n",
        { mode: 0o755 },
      );
      for (const file of envFiles) {
        const source = NodePath.join(project, file);
        const target = NodePath.join(checkout, file);
        NodeFS.writeFileSync(source, "shared dummy configuration\n");
        if (scenario === "real file") NodeFS.writeFileSync(target, "local dummy configuration\n");
        if (scenario === "directory") NodeFS.mkdirSync(target);
        if (scenario === "broken symlink") NodeFS.symlinkSync(NodePath.join(root, "gone"), target);
        if (scenario === "symlink source") {
          const actual = `${source}.actual`;
          NodeFS.renameSync(source, actual);
          NodeFS.symlinkSync(actual, source);
        }
      }
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        [NodePath.join(checkout, "scripts", "setup-worktree.ts")],
        {
          cwd: checkout,
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            T3CODE_PROJECT_ROOT: project,
            PATH: `${bin}${NodePath.delimiter}${process.env.PATH ?? ""}`,
          },
        },
      );
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      for (const file of envFiles) {
        const target = NodePath.join(checkout, file);
        const stat = NodeFS.lstatSync(target, { throwIfNoEntry: false });
        if (scenario === "real file" || scenario === "main checkout") {
          assert.isTrue(stat?.isFile());
          assert.equal(
            NodeFS.readFileSync(target, "utf8"),
            scenario === "real file"
              ? "local dummy configuration\n"
              : "shared dummy configuration\n",
          );
        } else if (scenario === "directory") {
          assert.isTrue(stat?.isDirectory());
        } else if (scenario === "symlink source") {
          assert.isUndefined(stat);
        } else {
          assert.isTrue(stat?.isSymbolicLink());
          assert.equal(
            NodeFS.realpathSync(target),
            NodeFS.realpathSync(NodePath.join(project, file)),
          );
          assert.equal(NodeFS.readFileSync(target, "utf8"), "shared dummy configuration\n");
        }
      }
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
);
