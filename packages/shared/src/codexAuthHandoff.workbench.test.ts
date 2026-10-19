import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import {
  codexAuthDeliveryUrl,
  codexAuthHandoffUrl,
  readCodexAuthDelivery,
  readCodexAuthHandoff,
} from "./codexAuthHandoff.ts";

const authorizationUrl = () => {
  const url = new URL("https://auth.openai.com/api/accounts/authorize");
  url.search = new URLSearchParams({
    client_id: "dynamic_agent_client",
    response_type: "code",
    redirect_uri: "http://127.0.0.1:54213/auth/callback",
    state: "a".repeat(43),
    code_challenge_method: "S256",
    code_challenge: "b".repeat(43),
  }).toString();
  return url.toString();
};
const input = {
  authorizationUrl: authorizationUrl(),
  returnUrl: "https://app.t3.codes/welcome#agents:remote-environment",
  environmentId: EnvironmentId.make("remote-environment"),
  instanceId: ProviderInstanceId.make("work-codex"),
  flowId: "flow-one",
};
const callbackUrl = `http://127.0.0.1:54213/auth/callback?state=${"a".repeat(43)}&code=one-time-code&client_id=oaiapp_test`;

describe("Codex desktop handoff", () => {
  it.each([false, true])("returns from Workbench desktop in development: %s", (development) => {
    const scheme = development ? "t3code-workbench-dev" : "t3code-workbench";
    const workbenchInput = {
      ...input,
      returnUrl: `${scheme}://app/settings/providers?instanceId=work-codex`,
    };
    const handoff = codexAuthHandoffUrl(workbenchInput, development, "t3code-workbench");
    expect(new URL(handoff).protocol).toBe(`${scheme}:`);
    expect(readCodexAuthHandoff(handoff, development, "t3code-workbench")).toEqual(workbenchInput);
    expect(readCodexAuthHandoff(handoff, development)).toBeUndefined();
    expect(readCodexAuthDelivery(codexAuthDeliveryUrl(workbenchInput, callbackUrl))).toMatchObject({
      returnUrl: workbenchInput.returnUrl,
      callbackUrl,
    });
  });
});
