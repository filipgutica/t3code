// @effect-diagnostics globalFetch:off - Standalone adapter contract uses an SDK/network fake; hosted provisioning is a separate integration check.
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
const fixture = vi.hoisted(() => ({
  create: vi.fn(),
  stop: vi.fn(),
  provision: vi.fn(),
  userCommand: vi.fn(),
}));
vi.mock("@vercel/sandbox", () => ({ Sandbox: { create: fixture.create } }));
import { launchPreview } from "./lifecycle.js";

const sha = "a".repeat(40);
const checksum = "b".repeat(64);
const environment = {
  WORKBENCH_PREVIEW_SHA: sha,
  WORKBENCH_PREVIEW_PR: "71",
  WORKBENCH_PREVIEW_BUNDLE_SHA256: checksum,
  WORKBENCH_PREVIEW_BUNDLE_URL: `https://github.com/filipgutica/t3code/releases/download/workbench-preview-builds/pr-71-${sha}-${checksum}.tar.gz`,
};
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({ state: "open", head: { sha, repo: { full_name: "filipgutica/t3code" } } }),
    ),
  );
  fixture.stop.mockResolvedValue(undefined);
  fixture.provision.mockResolvedValue({ exitCode: 0 });
  fixture.create.mockResolvedValue({
    stop: fixture.stop,
    runCommand: fixture.provision,
    createUser: async () => ({ runCommand: fixture.userCommand }),
    domain: () => "https://demo.vercel.run",
  });
  fixture.userCommand.mockReset();
  fixture.userCommand
    .mockResolvedValueOnce({ wait: () => new Promise(() => {}) })
    .mockResolvedValueOnce({ exitCode: 0 })
    .mockResolvedValueOnce({ exitCode: 0, stdout: async () => "native-token" });
});
afterEach(() => vi.unstubAllGlobals());

it("pins deployment artifact identity before provisioning and refuses a closed or changed PR", async () => {
  for (const invalid of [
    { WORKBENCH_PREVIEW_BUNDLE_URL: "https://attacker.invalid/payload" },
    { WORKBENCH_PREVIEW_SHA: "changed" },
    { WORKBENCH_PREVIEW_PR: "0" },
    { WORKBENCH_PREVIEW_BUNDLE_SHA256: "bad" },
  ]) {
    await expect(launchPreview({ ...environment, ...invalid })).rejects.toThrow("Invalid fixed");
  }
  expect(fetchMock).not.toHaveBeenCalled();
  expect(fixture.create).not.toHaveBeenCalled();
  for (const status of [200, 429, 503]) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status }));
    await expect(launchPreview(environment)).rejects.toThrow("Could not verify");
  }
  for (const pull of [
    { state: "closed", head: { sha, repo: { full_name: "filipgutica/t3code" } } },
    { state: "open", head: { sha: "c".repeat(40), repo: { full_name: "filipgutica/t3code" } } },
    { state: "open", head: { sha, repo: { full_name: "other/fork" } } },
  ]) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(pull)));
    await expect(launchPreview(environment)).resolves.toEqual({ unavailable: "revision-changed" });
  }
  expect(fixture.create).not.toHaveBeenCalled();
});

it.each(["download", "readiness", "runtime", "pairing"])(
  "stops the acquired disposable sandbox after %s failure",
  async (stage) => {
    if (stage === "download") fixture.provision.mockResolvedValueOnce({ exitCode: 1 });
    if (stage === "readiness" || stage === "runtime" || stage === "pairing") {
      fixture.userCommand.mockReset();
      fixture.userCommand
        .mockResolvedValueOnce({
          wait: () =>
            stage === "runtime" ? Promise.resolve({ exitCode: 1 }) : new Promise(() => {}),
        })
        .mockResolvedValueOnce(
          stage === "runtime" ? new Promise(() => {}) : { exitCode: stage === "readiness" ? 1 : 0 },
        )
        .mockResolvedValueOnce({ exitCode: 1 });
    }
    await expect(launchPreview(environment)).rejects.toThrow();
    expect(fixture.stop).toHaveBeenCalledTimes(1);
  },
);

it("returns native fragment pairing without host credentials and leaves success bounded by the sandbox lifetime", async () => {
  const result = await launchPreview({ ...environment, VERCEL_OIDC_TOKEN: "host-private" });
  expect(result).toEqual({ pairingUrl: "https://demo.vercel.run/pair#token=native-token" });
  expect(fixture.create.mock.calls[0]?.[0]).toMatchObject({
    persistent: false,
    timeout: 1200000,
    resources: { vcpus: 1 },
    ports: [8080],
  });
  expect(JSON.stringify(fixture.create.mock.calls)).not.toContain("host-private");
  expect(JSON.stringify(fixture.userCommand.mock.calls)).not.toContain("host-private");
  expect(fixture.stop).not.toHaveBeenCalled();
});
