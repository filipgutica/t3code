import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";

const packageRoot = NodeURL.fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = NodePath.resolve(packageRoot, "../..");
const applicationsRoot = NodePath.join(repositoryRoot, "apps") + NodePath.sep;
const manifests = new Map();
for (const directory of ["packages", "apps", "infra"]) {
  for (const entry of NodeFS.readdirSync(NodePath.join(repositoryRoot, directory), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const filename = NodePath.join(repositoryRoot, directory, entry.name, "package.json");
    if (!NodeFS.existsSync(filename)) continue;
    const manifest = JSON.parse(NodeFS.readFileSync(filename, "utf8"));
    manifests.set(manifest.name, { manifest, filename });
  }
}

const visit = (name, ancestors = []) => {
  if (ancestors.includes(name))
    throw new Error(`Workbench dependency cycle: ${[...ancestors, name].join(" -> ")}`);
  const entry = manifests.get(name);
  if (!entry) return;
  if (entry.filename.startsWith(applicationsRoot))
    throw new Error(`Workbench reaches application ${name}`);
  for (const dependency of Object.keys({
    ...entry.manifest.dependencies,
    ...entry.manifest.devDependencies,
    ...entry.manifest.peerDependencies,
    ...entry.manifest.optionalDependencies,
  })) {
    visit(dependency, [...ancestors, name]);
  }
};
visit("@t3tools/workbench");

// Ask the compiler for the actual resolved graph: relative, aliased and deep
// imports (including tests) must all stay outside applications.
const result = NodeChildProcess.spawnSync(
  "tsc",
  ["--project", "tsconfig.json", "--listFilesOnly"],
  {
    cwd: packageRoot,
    encoding: "utf8",
  },
);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stdout + result.stderr);
const applicationFiles = result.stdout
  .split(/\r?\n/)
  .filter((file) => NodePath.resolve(file).startsWith(applicationsRoot));
if (applicationFiles.length > 0)
  throw new Error(`Workbench imports application files:\n${applicationFiles.join("\n")}`);
console.log("Workbench boundary passed: no application sources or workspace dependency cycles.");
