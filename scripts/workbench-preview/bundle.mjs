import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeStreamPromises from "node:stream/promises";

const [image = "workbench-preview:local", output = "/tmp/workbench-preview.tar.gz"] =
  process.argv.slice(2);
// Export only installed code and tools. The container never starts or imports host state.
const child = NodeChildProcess.spawn(
  "docker",
  [
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    image,
    "-c",
    [
      "mkdir -p /tmp/workbench-bundle/node-bin",
      "cp /usr/local/bin/node /tmp/workbench-bundle/node-bin/node",
      "cp -a /usr/local/lib/node_modules/opencode-ai /tmp/workbench-bundle/opencode",
      "ln -s ../opencode/bin/opencode.exe /tmp/workbench-bundle/node-bin/opencode",
      "tar --exclude=app/node_modules/.tmp -czf - -C / app -C /tmp/workbench-bundle node-bin opencode",
    ].join(" && "),
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);
const exited = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) =>
    code === 0 ? resolve() : reject(new Error("Preview bundle export failed")),
  );
});
await Promise.all([
  NodeStreamPromises.pipeline(child.stdout, NodeFS.createWriteStream(output, { mode: 0o600 })),
  exited,
]);
