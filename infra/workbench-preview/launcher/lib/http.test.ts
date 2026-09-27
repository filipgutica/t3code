// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - Native Vercel HTTP boundary and local contract test are independent of the application runtime.
import * as NodeHttp from "node:http";
import { expect, it, vi } from "vite-plus/test";
import { handleLaunch } from "./http.js";

it("denies unsafe requests before provisioning and returns only a private uncached pairing response", async () => {
  const launch = vi.fn<() => Promise<{ pairingUrl: string } | { unavailable: "revision-changed" }>>(
    async () => ({ pairingUrl: "https://demo.vercel.run/pair#token=private" }),
  );
  const environment = { VERCEL_ENV: "preview", VERCEL_URL: "launcher.vercel.app" };
  const server = NodeHttp.createServer((request, response) => {
    void handleLaunch({ request, response, environment, launch });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP test port");
  const url = `http://127.0.0.1:${address.port}/api/launch`;
  try {
    expect((await fetch(url)).status).toBe(405);
    expect((await fetch(url, { method: "POST" })).status).toBe(403);
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: { Origin: "https://other.vercel.app", Host: "launcher.vercel.app" },
        })
      ).status,
    ).toBe(403);
    const headers = { Origin: "https://launcher.vercel.app" };
    expect((await fetch(url + "?image=other", { method: "POST", headers })).status).toBe(400);
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ sha: "other", image: "other" }),
        })
      ).status,
    ).toBe(400);
    environment.VERCEL_ENV = "production";
    expect((await fetch(url, { method: "POST", headers })).status).toBe(503);
    expect(launch).not.toHaveBeenCalled();
    environment.VERCEL_ENV = "preview";
    const success = await fetch(url, { method: "POST", headers });
    expect(success.status).toBe(200);
    expect(success.headers.get("cache-control")).toBe("no-store");
    expect(await success.json()).toEqual({
      pairingUrl: "https://demo.vercel.run/pair#token=private",
    });
    launch.mockResolvedValueOnce({ unavailable: "revision-changed" });
    const stale = await fetch(url, { method: "POST", headers });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error:
        "This preview is out of date or its PR has closed. Open the latest demo link from the PR.",
    });
    launch.mockRejectedValueOnce(new Error("private-sdk-token"));
    const failure = await fetch(url, { method: "POST", headers });
    expect(failure.status).toBe(502);
    expect(await failure.text()).not.toContain("private-sdk-token");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
