#!/usr/bin/env node
import * as NodeReadline from "node:readline";

const lines = NodeReadline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type !== "control_request" || message.request?.subtype !== "initialize") return;
  process.stdout.write(
    JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: message.request_id,
        response: {
          commands: [],
          agents: [],
          models: [],
          account: {
            tokenSource: "none",
            apiKeySource: "ANTHROPIC_API_KEY",
            apiProvider: "firstParty",
          },
        },
      },
    }) + "\n",
  );
});
