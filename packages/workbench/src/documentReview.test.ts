import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  type DocumentWriter,
  documentWrite,
  nextReviewBase,
  resolvedReview,
} from "./documentReview.ts";

const agent: DocumentWriter = { kind: "agent", threadId: ThreadId.make("review-agent") };
const askForChange: DocumentWriter = { kind: "askForChange" };
const user: DocumentWriter = { kind: "user" };
const original = { title: "Validate requests", markdown: "Reject invalid sizes." };
const first = { title: "Validate requests", markdown: "Reject invalid sizes early." };
const second = { title: "Validate inputs", markdown: "Reject invalid sizes before querying." };

describe("nextReviewBase", () => {
  it("bases the review on the document before the first unreviewed write", () => {
    const base = nextReviewBase({ writer: agent, base: null, before: original, after: first });
    expect(base).toEqual(original);
    expect(nextReviewBase({ writer: askForChange, base, before: first, after: second })).toBe(base);
  });

  it("sets no base for a write to an empty body", () => {
    expect(
      nextReviewBase({
        writer: agent,
        base: null,
        before: { title: "", markdown: " \n" },
        after: first,
      }),
    ).toBeNull();
  });

  it("ends the review when a write returns to the base", () => {
    expect(nextReviewBase({ writer: agent, base: original, before: first, after: original })).toBe(
      null,
    );
  });

  it("ends the review on a user content edit and keeps it on writes that change no content", () => {
    expect(nextReviewBase({ writer: user, base: original, before: first, after: second })).toBe(
      null,
    );
    expect(nextReviewBase({ writer: user, base: original, before: first, after: first })).toBe(
      original,
    );
    expect(nextReviewBase({ writer: agent, base: original, before: first, after: first })).toBe(
      original,
    );
  });
});

describe("an accepted change", () => {
  const written = {
    ...first,
    updatedByThreadId: ThreadId.make("review-agent"),
    updatedByAskForChange: false,
  };

  it("stays viewable after Accept and never feeds the next review", () => {
    const accepted = resolvedReview("accept", original);
    expect(accepted).toEqual({ reviewBase: null, acceptedBase: original });
    // The next review starts from the accepted text, so Undo cannot revert the accepted change.
    expect(
      documentWrite({ writer: agent, before: { ...written, ...accepted }, after: second }),
    ).toMatchObject({ reviewBase: first, acceptedBase: null });
    expect(
      documentWrite({ writer: agent, before: { ...written, ...accepted }, after: original }),
    ).toMatchObject({ reviewBase: first, acceptedBase: null });
  });

  it("survives writes that change no content, and ends on a user edit or Undo", () => {
    const accepted = resolvedReview("accept", original);
    expect(
      documentWrite({ writer: agent, before: { ...written, ...accepted }, after: first }),
    ).toMatchObject({ reviewBase: null, acceptedBase: original });
    expect(
      documentWrite({ writer: user, before: { ...written, ...accepted }, after: second }),
    ).toMatchObject({ reviewBase: null, acceptedBase: null });
    expect(resolvedReview("undo", original)).toEqual({ reviewBase: null, acceptedBase: null });
  });
});
