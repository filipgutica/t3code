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

const manifest = (version: string, url = "update.zip") =>
  [
    `version: ${version}`,
    "files:",
    `  - url: ${url}`,
    "    sha512: hash",
    `path: ${url}`,
    "sha512: hash",
    "releaseDate: 2026-10-07T00:00:00Z",
  ].join("\n");

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

  it.each([
    { channel: "latest", platform: "darwin", version: "0.0.3", file: "latest-mac.yml" },
    {
      channel: "nightly",
      platform: "darwin",
      version: "0.0.4-nightly.20261007.10",
      file: "nightly-mac.yml",
    },
    {
      channel: "nightly",
      platform: "linux",
      version: "0.0.4-nightly.20261007.10",
      file: "nightly-linux.yml",
    },
    {
      channel: "nightly",
      platform: "win32",
      version: "0.0.4-nightly.20261007.10",
      file: "nightly.yml",
    },
  ] as const)(
    "selects $channel releases and $platform manifests",
    async ({ channel, platform, version, file }) => {
      const releases = [
        release("workbench-daily-v0.0.4-nightly.20261007.9", {
          assets: [
            { name: "nightly.yml" },
            { name: "nightly-linux.yml" },
            { name: "nightly-mac.yml" },
          ],
        }),
        release("workbench-daily-v0.0.4-nightly.20261007.10", {
          assets: [
            { name: "nightly.yml" },
            { name: "nightly-linux.yml" },
            { name: "nightly-mac.yml" },
          ],
        }),
        release("workbench-v0.0.3", { prerelease: true }),
        release("workbench-daily-v9.0.0-nightly.20261007.1", {
          draft: true,
          assets: [{ name: file }],
        }),
        release("workbench-daily-v9.0.0-nightly.20261007.2", {
          published_at: null,
          assets: [{ name: file }],
        }),
        ...[
          "workbench-v9.0.0-nightly.20261007.1",
          "workbench-daily-v9.0.0-nightly.20261007.01",
          "workbench-daily-v9.0.0-nightly.20261007.1+sha",
          "workbench-daily-v9.0.0-preview.20261007.1",
          "workbench-daily-v9.0.0-nightly.2026107.1",
        ].map((tag) => release(tag, { assets: [{ name: file }] })),
      ];
      const request = vi
        .fn()
        .mockResolvedValueOnce(JSON.stringify(releases))
        .mockResolvedValueOnce(manifest(version));
      const updater = { currentVersion: { version: "0.0.2" }, channel };
      const provider = new WorkbenchGithubProvider({ channel: "latest" }, updater, {
        isUseMultipleRangeRequest: false,
        platform,
        executor: makeExecutor(request),
      });

      const info = await provider.getLatestVersion();
      const tag = channel === "latest" ? `workbench-v${version}` : `workbench-daily-v${version}`;

      assert.equal(info.version, version);
      assert.equal(info.tag, tag);
      expect(request.mock.calls[1]?.[0]).toMatchObject({
        path: expect.stringContaining(`${tag}/${file}`),
      });
      assert.equal(
        provider.resolveFiles(info)[0]?.url.href,
        `https://github.com/filipgutica/t3code/releases/download/${tag}/update.zip`,
      );
    },
  );

  it.each([
    {
      stable: "0.0.3",
      daily: "0.0.4-nightly.20261008.1",
      expected: "0.0.4-nightly.20261008.1",
      file: "nightly-mac.yml",
    },
    {
      stable: "0.0.4",
      daily: "0.0.4-nightly.20261008.1",
      expected: "0.0.4",
      file: "latest-mac.yml",
    },
  ])("orders the next daily against stable $stable", async ({ stable, daily, expected, file }) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify([
          release(`workbench-v${stable}`),
          release("workbench-daily-v0.0.4-nightly.20261007.999", {
            assets: [{ name: "nightly-mac.yml" }],
          }),
          release(`workbench-daily-v${daily}`, { assets: [{ name: "nightly-mac.yml" }] }),
        ]),
      )
      .mockResolvedValueOnce(manifest(expected));
    const updater = { currentVersion: { version: "0.0.3-nightly.20261006.1" }, channel: "nightly" };
    const provider = new WorkbenchGithubProvider({ channel: "latest" }, updater, {
      isUseMultipleRangeRequest: false,
      platform: "darwin",
      executor: makeExecutor(request),
    });

    assert.equal((await provider.getLatestVersion()).version, expected);
    expect(request.mock.calls[1]?.[0]).toMatchObject({ path: expect.stringContaining(`/${file}`) });
  });

  it("follows live channel changes without replacing the provider", async () => {
    const releases = JSON.stringify([
      release("workbench-v0.0.3"),
      release("workbench-daily-v0.0.4-nightly.20261007.1", {
        assets: [{ name: "nightly-mac.yml" }],
      }),
    ]);
    const request = vi
      .fn()
      .mockResolvedValueOnce(releases)
      .mockResolvedValueOnce(manifest("0.0.3"))
      .mockResolvedValueOnce(releases)
      .mockResolvedValueOnce(manifest("0.0.4-nightly.20261007.1"));
    const updater = { currentVersion: { version: "0.0.2" }, channel: "latest" };
    const provider = new WorkbenchGithubProvider({ channel: "latest" }, updater, {
      isUseMultipleRangeRequest: false,
      platform: "darwin",
      executor: makeExecutor(request),
    });

    assert.equal((await provider.getLatestVersion()).version, "0.0.3");
    updater.channel = "nightly";
    assert.equal((await provider.getLatestVersion()).version, "0.0.4-nightly.20261007.1");
  });

  it.each([
    {
      current: "0.0.4-nightly.20261007.1",
      channel: "latest",
      allowDowngrade: false,
      expected: "0.0.4-nightly.20261007.1",
      requests: 1,
    },
    {
      current: "0.0.4-nightly.20261007.1",
      channel: "latest",
      allowDowngrade: true,
      expected: "0.0.3",
      requests: 2,
    },
    { current: "0.0.4", channel: "latest", allowDowngrade: true, expected: "0.0.3", requests: 2 },
    {
      current: "0.0.4-nightly.20261007.1",
      channel: "nightly",
      allowDowngrade: true,
      expected: "0.0.4-nightly.20261007.1",
      requests: 1,
    },
    { current: "0.0.3", channel: "latest", allowDowngrade: true, expected: "0.0.3", requests: 1 },
  ])(
    "permits only explicit stable switch-back: $channel/$allowDowngrade/$current",
    async ({ current, channel, allowDowngrade, expected, requests }) => {
      const request = vi
        .fn()
        .mockResolvedValueOnce(JSON.stringify([release("workbench-v0.0.3")]))
        .mockResolvedValueOnce(manifest("0.0.3"));
      const updater = { currentVersion: { version: current }, channel, allowDowngrade };
      const provider = new WorkbenchGithubProvider({ channel: "latest" }, updater, {
        isUseMultipleRangeRequest: false,
        platform: "darwin",
        executor: makeExecutor(request),
      });

      assert.equal((await provider.getLatestVersion()).version, expected);
      assert.equal(request.mock.calls.length, requests);
    },
  );

  it("paginates past unrelated releases", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(Array.from({ length: 100 }, () => release("v9.9.9"))))
      .mockResolvedValueOnce(JSON.stringify([release("workbench-v0.0.2")]))
      .mockResolvedValueOnce(manifest("0.0.2"));
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
      .mockResolvedValueOnce(manifest("0.0.2"));
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
      .mockResolvedValueOnce(manifest("0.0.3", "https://example.com/update.zip"));
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
      .mockResolvedValueOnce(manifest("0.0.2", "https://example.com/update.zip"));
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
