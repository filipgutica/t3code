// @effect-diagnostics nodeBuiltinImport:off - Standalone provisioning contract executes real local download and archive operations in temporary fixtures.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeHttp from "node:http";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import { expect, it } from "vite-plus/test";
import { provisionScript } from "./provision.js";

it("verifies downloaded bytes before extraction and preserves the bundled CLI link without touching unrelated state", async () => {
  const parent = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "preview-provision-test-"));
  const source = NodePath.join(parent, "source");
  await NodeFSP.mkdir(NodePath.join(source, "app"), { recursive: true });
  await NodeFSP.mkdir(NodePath.join(source, "node-bin"));
  await NodeFSP.writeFile(NodePath.join(source, "app", "proof"), "trusted-public-code");
  await NodeFSP.symlink(
    "../opencode/bin/opencode.exe",
    NodePath.join(source, "node-bin", "opencode"),
  );
  const archivePath = NodePath.join(parent, "fixture.tar.gz");
  await new Promise<void>((resolve, reject) =>
    NodeChildProcess.execFile("tar", ["-czf", archivePath, "-C", source, "."], (error) =>
      error ? reject(error) : resolve(),
    ),
  );
  const archive = await NodeFSP.readFile(archivePath);
  const checksum = NodeCrypto.createHash("sha256").update(archive).digest("hex");
  const server = NodeHttp.createServer((request, response) => {
    response.statusCode = request.url === "/fixture" ? 200 : 404;
    response.end(request.url === "/fixture" ? archive : "missing");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  const origin = `http://127.0.0.1:${address.port}`;
  const owner = `${process.getuid?.()}:${process.getgid?.()}`;
  const run = (url: string, hash: string, destination: string, state: string) =>
    new Promise<void>((resolve, reject) =>
      NodeChildProcess.execFile(
        process.execPath,
        ["-e", provisionScript, url, hash, destination, state, owner],
        { timeout: 10000 },
        (error) => (error ? reject(error) : resolve()),
      ),
    );
  try {
    const rejected = NodePath.join(parent, "rejected");
    await expect(
      run(origin + "/fixture", "0".repeat(64), rejected, NodePath.join(parent, "bad-state")),
    ).rejects.toThrow();
    await expect(NodeFSP.lstat(rejected)).rejects.toThrow();
    await expect(
      run(origin + "/missing", checksum, rejected, NodePath.join(parent, "bad-state")),
    ).rejects.toThrow();
    const destination = NodePath.join(parent, "installed");
    const state = NodePath.join(parent, "owned-state");
    await run(origin + "/fixture", checksum, destination, state);
    expect(await NodeFSP.readFile(NodePath.join(destination, "app", "proof"), "utf8")).toBe(
      "trusted-public-code",
    );
    expect(await NodeFSP.readlink(NodePath.join(destination, "node-bin", "opencode"))).toBe(
      "../opencode/bin/opencode.exe",
    );
    expect(await NodeFSP.readFile(NodePath.join(state, ".workbench-preview-owned"), "utf8")).toBe(
      "workbench-preview-v1\n",
    );
    expect((await NodeFSP.stat(state)).mode & 0o777).toBe(0o700);
    expect(await NodeFSP.readFile(NodePath.join(source, "app", "proof"), "utf8")).toBe(
      "trusted-public-code",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await NodeFSP.rm(parent, { recursive: true, force: true });
  }
});
