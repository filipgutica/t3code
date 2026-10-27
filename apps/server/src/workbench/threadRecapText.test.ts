import { describe, expect, it } from "vite-plus/test";

import { buildThreadRecapPrompt, sanitizeThreadRecap } from "./threadRecapText.ts";

describe("buildThreadRecapPrompt", () => {
  it("keeps the end of a long run within the transcript budget", () => {
    const { prompt } = buildThreadRecapPrompt({
      messages: [
        { role: "user", text: "first request" },
        ...Array.from({ length: 6 }, (_, index) => ({
          role: "assistant" as const,
          text: `${index}`.repeat(3_500),
        })),
        { role: "assistant", text: "Updated contracts.ts; next wire the web client." },
      ],
    });

    expect(prompt).not.toContain("first request");
    expect(prompt).toContain("assistant: Updated contracts.ts; next wire the web client.");
    expect(prompt.length).toBeLessThan(20_000);
  });
});

describe("sanitizeThreadRecap", () => {
  it("flattens the recap and caps it at 240 characters", () => {
    expect(sanitizeThreadRecap("Moved validation\n\ninto schema.ts.")).toBe(
      "Moved validation into schema.ts.",
    );
    const capped = sanitizeThreadRecap("word ".repeat(100));
    expect(capped).toHaveLength(240);
    expect(capped.endsWith("...")).toBe(true);
  });
});
