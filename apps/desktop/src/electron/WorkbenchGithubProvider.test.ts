import { assert, describe, it } from "@effect/vitest";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor.js";
import { expect, vi } from "vite-plus/test";

import {
  selectLatestWorkbenchRelease,
  WorkbenchGithubProvider,
} from "./WorkbenchGithubProvider.ts";

const release = (tag_name: string, overrides: Record<string, unknown> = {}) => ({
  draft: false,
  tag_name,
  name: null,
  body: null,
  published_at: "2026-09-13T00:00:00Z",
  assets: [{ name: "latest.yml" }, { name: "latest-linux.yml" }, { name: "latest-mac.yml" }],
  ...overrides,
});

const makeExecutor = (request: ElectronHttpExecutor["request"]): ElectronHttpExecutor => {
  const executor = new ElectronHttpExecutor();
  vi.spyOn(executor, "request").mockImplementation(request);
  return executor;
};

describe("WorkbenchGithubProvider", () => {
  it("selects only the highest published Workbench version", () => {
    const latest = selectLatestWorkbenchRelease([
      release("v9.9.9"),
      release("workbench-v0.0.2", { draft: true }),
      release("workbench-v0.0.1"),
      release("workbench-v0.0.3"),
      release("workbench-v0.0.3-beta.1"),
      release("workbench-v0.0.4", { published_at: null }),
    ]);

    assert.equal(latest?.tag_name, "workbench-v0.0.3");
    assert.equal(latest?.version, "0.0.3");
  });

  it("paginates past unrelated releases", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(Array.from({ length: 100 }, () => release("v9.9.9"))))
      .mockResolvedValueOnce(JSON.stringify([release("workbench-v0.0.2")]))
      .mockResolvedValueOnce(
        [
          "version: 0.0.2",
          "files:",
          "  - url: update.zip",
          "    sha512: hash",
          "path: update.zip",
          "sha512: hash",
          "releaseDate: 2026-09-13T00:00:00Z",
        ].join("\n"),
      );
    const provider = new WorkbenchGithubProvider(
      { channel: "latest" },
      { currentVersion: { version: "0.0.1" } },
      {
        isUseMultipleRangeRequest: false,
        platform: "darwin",
        executor: makeExecutor(request),
      },
    );

    const info = await provider.getLatestVersion();

    assert.equal(info.version, "0.0.2");
    assert.equal(request.mock.calls.length, 3);
    expect(request.mock.calls[1]?.[0]).toMatchObject({ path: expect.stringContaining("page=2") });
  });

  it("does not fetch an older release manifest", async () => {
    const request = vi.fn(async () => JSON.stringify([release("workbench-v0.0.1")]));
    const provider = new WorkbenchGithubProvider(
      { channel: "latest" },
      { currentVersion: { version: "0.0.2" } },
      {
        isUseMultipleRangeRequest: false,
        platform: "darwin",
        executor: makeExecutor(request),
      },
    );

    const info = await provider.getLatestVersion();

    assert.equal(info.version, "0.0.2");
    assert.equal(request.mock.calls.length, 1);
  });

  it("reports no update when the newest release has no manifest for the platform", async () => {
    const request = vi.fn(async () =>
      JSON.stringify([release("workbench-v0.0.3", { assets: [{ name: "latest.yml" }] })]),
    );
    const provider = new WorkbenchGithubProvider(
      { channel: "latest" },
      { currentVersion: { version: "0.0.2" } },
      {
        isUseMultipleRangeRequest: false,
        platform: "darwin",
        executor: makeExecutor(request),
      },
    );

    const info = await provider.getLatestVersion();

    assert.equal(info.version, "0.0.2");
    assert.equal(request.mock.calls.length, 1);
  });

  it("skips a newer unsigned macOS release when an older signed release is available", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify([
          release("workbench-v0.0.3", { assets: [{ name: "latest.yml" }] }),
          release("workbench-v0.0.2"),
        ]),
      )
      .mockResolvedValueOnce(
        [
          "version: 0.0.2",
          "files:",
          "  - url: update.zip",
          "    sha512: hash",
          "path: update.zip",
          "sha512: hash",
          "releaseDate: 2026-09-13T00:00:00Z",
        ].join("\n"),
      );
    const provider = new WorkbenchGithubProvider(
      { channel: "latest" },
      { currentVersion: { version: "0.0.1" } },
      {
        isUseMultipleRangeRequest: false,
        platform: "darwin",
        executor: makeExecutor(request),
      },
    );

    const info = await provider.getLatestVersion();

    assert.equal(info.version, "0.0.2");
    assert.equal(request.mock.calls.length, 2);
    expect(request.mock.calls[1]?.[0]).toMatchObject({
      path: expect.stringContaining("workbench-v0.0.2/latest-mac.yml"),
    });
  });

  it("rejects a manifest whose version does not match the release", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify([release("workbench-v0.0.2")]))
      .mockResolvedValueOnce(
        [
          "version: 0.0.3",
          "files:",
          "  - url: https://example.com/update.zip",
          "    sha512: hash",
          "path: update.zip",
          "sha512: hash",
          "releaseDate: 2026-09-13T00:00:00Z",
        ].join("\n"),
      );
    const provider = new WorkbenchGithubProvider(
      { channel: "latest" },
      { currentVersion: { version: "0.0.1" } },
      {
        isUseMultipleRangeRequest: false,
        platform: "darwin",
        executor: makeExecutor(request),
      },
    );

    await expect(provider.getLatestVersion()).rejects.toThrow(
      /manifest version 0\.0\.3 does not match/,
    );
  });

  it("rejects update assets outside the selected GitHub release", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify([release("workbench-v0.0.2")]))
      .mockResolvedValueOnce(
        [
          "version: 0.0.2",
          "files:",
          "  - url: https://example.com/update.zip",
          "    sha512: hash",
          "path: update.zip",
          "sha512: hash",
          "releaseDate: 2026-09-13T00:00:00Z",
        ].join("\n"),
      );
    const provider = new WorkbenchGithubProvider(
      { channel: "latest" },
      { currentVersion: { version: "0.0.1" } },
      {
        isUseMultipleRangeRequest: false,
        platform: "darwin",
        executor: makeExecutor(request),
      },
    );

    const info = await provider.getLatestVersion();
    assert.throws(() => provider.resolveFiles(info), /outside its GitHub release/);
  });
});
