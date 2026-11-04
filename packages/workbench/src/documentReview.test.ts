import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  type DocumentWriter,
  type ReviewDocument,
  documentWrite,
  resolvedReview,
} from "./documentReview.ts";

const agent: DocumentWriter = { kind: "agent", threadId: ThreadId.make("review-agent") };
const askForChange: DocumentWriter = { kind: "askForChange" };
const user: DocumentWriter = { kind: "user" };
const original = { title: "Validate requests", markdown: "Reject invalid sizes." };
const first = { title: "Validate requests", markdown: "Reject invalid sizes early." };
const second = { title: "Validate inputs", markdown: "Reject invalid sizes before querying." };

const empty = { title: "", markdown: " \n" };

describe("the review base after a write", () => {
  it.each([
    {
      name: "the first unreviewed write saves the base",
      writer: agent,
      base: null,
      before: original,
      after: first,
      expected: original,
    },
    {
      name: "later writes keep it",
      writer: askForChange,
      base: original,
      before: first,
      after: second,
      expected: original,
    },
    {
      name: "a write to an empty body sets none",
      writer: agent,
      base: null,
      before: empty,
      after: first,
      expected: null,
    },
    {
      name: "a write back to the base ends the review",
      writer: agent,
      base: original,
      before: first,
      after: original,
      expected: null,
    },
    {
      name: "a user content edit ends the review",
      writer: user,
      base: original,
      before: first,
      after: second,
      expected: null,
    },
    {
      name: "a user write that changes no content keeps it",
      writer: user,
      base: original,
      before: first,
      after: first,
      expected: original,
    },
    {
      name: "an agent write that changes no content keeps it",
      writer: agent,
      base: original,
      before: first,
      after: first,
      expected: original,
    },
  ] satisfies ReadonlyArray<{
    name: string;
    writer: DocumentWriter;
    base: ReviewDocument | null;
    before: ReviewDocument;
    after: ReviewDocument;
    expected: ReviewDocument | null;
  }>)("$name", ({ writer, base, before, after, expected }) => {
    const written = documentWrite({
      writer,
      before: {
        ...before,
        updatedByThreadId: null,
        updatedByAskForChange: false,
        reviewBase: base,
        acceptedBase: null,
      },
      after,
    });
    expect(written.reviewBase).toEqual(expected);
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
