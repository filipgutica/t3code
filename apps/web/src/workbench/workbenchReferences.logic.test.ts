import { ThreadId, WorkbenchTicketId, type WorkbenchReference } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  listWorkbenchTicketReferences,
  parseDescriptionHref,
  workbenchDescriptionLinks,
  workbenchReferenceOpenTarget,
} from "./workbenchReferences.logic";

const ticketId = WorkbenchTicketId.make("ticket-1");
const saved = (url: string, title: string | null = null): WorkbenchReference => ({
  ticketId,
  url,
  title,
  addedByThreadId: ThreadId.make("thread-1"),
  createdAt: "2026-11-01T00:00:00.000Z",
});

describe("workbenchDescriptionLinks", () => {
  it("lists each Reference link once, with its text as the title", () => {
    const links = workbenchDescriptionLinks(
      [
        "- [plan.md](/work/artifacts/plan.md): how every PR works",
        "- Tracking issue https://github.com/acme/app/issues/12",
        "- Example PR [acme/app#17](https://github.com/acme/app/pull/17/files)",
        "- Again [the plan](/work/artifacts/plan.md), a [section](#scope), and [notes](notes.md)",
        "",
        "```md",
        "[in code](https://example.com/ignored)",
        "```",
      ].join("\n"),
    );
    expect(links.map(({ parsed, title }) => [parsed.kind, parsed.url, title])).toEqual([
      ["file", "/work/artifacts/plan.md", "plan.md"],
      ["github_issue", "https://github.com/acme/app/issues/12", null],
      ["github_pull_request", "https://github.com/acme/app/pull/17", "acme/app#17"],
    ]);
  });

  it("resolves reference-style links against their definitions", () => {
    const links = workbenchDescriptionLinks(
      "See [the plan][plan] and [PR][pr].\n\n[plan]: /work/plan.md\n[PR]: https://github.com/acme/app/pull/4",
    );
    expect(links.map(({ parsed, title }) => [parsed.url, title])).toEqual([
      ["/work/plan.md", "the plan"],
      ["https://github.com/acme/app/pull/4", "PR"],
    ]);
  });

  it("reads a percent-encoded file destination as the path the chip opens", () => {
    const links = workbenchDescriptionLinks(
      "[Plan](/work/My%20Plan.md) and [again](</work/My Plan.md>)",
    );
    expect(links.map(({ parsed }) => parsed.url)).toEqual(["/work/My Plan.md"]);
  });
});

describe("parseDescriptionHref", () => {
  it("reads a rendered link's percent-encoded host path as the literal path", () => {
    expect(parseDescriptionHref("/work/My%20Plan%C3%A9.md")?.url).toBe("/work/My Plané.md");
    expect(parseDescriptionHref("https://example.com/a%20b")?.url).toBe(
      "https://example.com/a%20b",
    );
  });
});

describe("listWorkbenchTicketReferences", () => {
  it("lists saved References first, then description links no saved one covers", () => {
    const links = workbenchDescriptionLinks(
      "[Spec](https://docs.example.com/spec) [Plan](/work/plan.md) [PR](https://github.com/acme/app/pull/3)",
    );
    const { listed, descriptionPullRequests } = listWorkbenchTicketReferences(
      [saved("/work/plan.md", "Plan"), saved("https://github.com/acme/app/pull/9")],
      links,
    );
    expect(listed.map((item) => [item.source, item.parsed.url])).toEqual([
      ["saved", "/work/plan.md"],
      ["description", "https://docs.example.com/spec"],
    ]);
    expect(descriptionPullRequests.map((link) => link.parsed.url)).toEqual([
      "https://github.com/acme/app/pull/3",
    ]);
  });
});

describe("workbenchReferenceOpenTarget", () => {
  const page = { hasThread: true, canOpenInApp: true, linksOpenInApp: true, hasFileSheet: true };
  const file = (url: string) => ({ kind: "file" as const, url });
  const link = { kind: "link" as const, url: "https://docs.example.com/spec" };

  it("opens beside the chat's Thread when one shows", () => {
    expect(workbenchReferenceOpenTarget(file("/work/plan.md"), page)).toBe("file_panel");
    expect(workbenchReferenceOpenTarget(file("/work/mockup.html"), page)).toBe("browser_panel");
    expect(workbenchReferenceOpenTarget(file("/work/spec.pdf"), page)).toBe("browser_panel");
    expect(
      workbenchReferenceOpenTarget(file("/work/mockup.html"), { ...page, canOpenInApp: false }),
    ).toBe("file_panel");
    expect(workbenchReferenceOpenTarget(link, page)).toBe("browser_panel");
    expect(workbenchReferenceOpenTarget(link, { ...page, linksOpenInApp: false })).toBe(
      "system_browser",
    );
    expect(workbenchReferenceOpenTarget({ kind: "github_pull_request", url: link.url }, page)).toBe(
      "pull_request_panel",
    );
  });

  it("falls back to the file sheet and system browser without a Thread", () => {
    const noThread = { ...page, hasThread: false };
    expect(workbenchReferenceOpenTarget(file("/work/mockup.html"), noThread)).toBe("file_sheet");
    expect(
      workbenchReferenceOpenTarget(file("/work/plan.md"), { ...noThread, hasFileSheet: false }),
    ).toBe("none");
    expect(workbenchReferenceOpenTarget(link, noThread)).toBe("system_browser");
    expect(
      workbenchReferenceOpenTarget({ kind: "github_pull_request", url: link.url }, noThread),
    ).toBe("pull_request_sheet");
  });
});
