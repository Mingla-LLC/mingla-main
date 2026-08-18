/**
 * issue #2009 — IMPLEMENTOR REWORK COVERAGE for pass-1 TEST REPORT P2-2,
 * Business editor half.
 *
 * THE DEFECT. `business_set_event_visibility` raises ONE stable code,
 * `private_visibility_unavailable`, on BOTH legs of the Private boundary:
 * entering Private (the prerequisite #2144 has not shipped) and leaving an
 * event that is already Private (the same machinery has to unwind it).
 * `issue2009VisibilityErrorCopy` mapped that one code to one sentence —
 * "Private events are not ready to accept invited guests yet. Choose Public or
 * Unlisted for now." On the exit leg, an organiser who had just chosen Public
 * was told to choose Public.
 *
 * WHAT THIS FILE PROVES. It CALLS the shipped copy function with the real
 * server codes and reads the sentence an organiser would actually see (#2113 —
 * no source-text assertion). It pins BOTH directions, because a fix that
 * reworded the shared sentence would satisfy "the exit leg reads differently"
 * while quietly breaking the copy the BINDING SPEC approved verbatim.
 */

import {
  ISSUE_2009_PRIVATE_EXIT_UNAVAILABLE_COPY,
  ISSUE_2009_PRIVATE_UNAVAILABLE_COPY,
  ISSUE_2009_VISIBILITY_ERROR_CODES,
  issue2009VisibilityErrorCopy,
  issue2009VisibilityErrorCopyForLeg,
} from "../publishedEventVisibility.issue2009";

/** The BINDING SPEC §6 sentence, transcribed here rather than imported, so a
 *  reword of the exported constant cannot make this assertion agree with it. */
const APPROVED_ENTERING_COPY =
  "Private events are not ready to accept invited guests yet. Choose Public or Unlisted for now.";

const PRIVATE_CODE = ISSUE_2009_VISIBILITY_ERROR_CODES.privateUnavailable;

describe("issue #2009 P2-2 — the Private refusal reads correctly in BOTH directions", () => {
  it("keeps the approved entering-Private copy verbatim", () => {
    expect(ISSUE_2009_PRIVATE_UNAVAILABLE_COPY).toBe(APPROVED_ENTERING_COPY);
    // No context at all — the organiser selected Private on a Public event.
    expect(issue2009VisibilityErrorCopy(PRIVATE_CODE)).toBe(APPROVED_ENTERING_COPY);
    // ...and explicitly, from a non-private starting point.
    expect(
      issue2009VisibilityErrorCopyForLeg(PRIVATE_CODE, "public"),
    ).toBe(APPROVED_ENTERING_COPY);
    expect(
      issue2009VisibilityErrorCopyForLeg(PRIVATE_CODE, "unlisted"),
    ).toBe(APPROVED_ENTERING_COPY);
  });

  it("gives the exit leg copy that makes sense for the exit leg", () => {
    const exit = issue2009VisibilityErrorCopyForLeg(PRIVATE_CODE, "private");

    expect(exit).toBe(ISSUE_2009_PRIVATE_EXIT_UNAVAILABLE_COPY);
    expect(exit).not.toBe(APPROVED_ENTERING_COPY);
    // The exact wrongness that was reported: telling someone leaving Private to
    // choose Public or Unlisted is repeating back the thing they just tried.
    expect(exit).not.toMatch(/Choose Public or Unlisted for now/i);
    // It must still say what is true and what to do next.
    expect(exit).toMatch(/private/i);
    expect(exit).toMatch(/support/i);
  });

  it("routes on the STORED value the editor loaded, not on what was requested", () => {
    // The editor passes `liveEvent.visibility`. A missing / unknown value must
    // fall back to the approved entering copy rather than the exit sentence —
    // an unknown direction is never treated as the exit.
    for (const previousVisibility of [undefined, null, "", "draft", "hidden"]) {
      expect(
        issue2009VisibilityErrorCopyForLeg(PRIVATE_CODE, previousVisibility),
      ).toBe(APPROVED_ENTERING_COPY);
    }
  });

  it("does not leak the split into any other stable code", () => {
    const others: Array<[string, RegExp]> = [
      [ISSUE_2009_VISIBILITY_ERROR_CODES.stale, /changed elsewhere/i],
      [ISSUE_2009_VISIBILITY_ERROR_CODES.notFound, /no longer have permission/i],
      [ISSUE_2009_VISIBILITY_ERROR_CODES.notAuthenticated, /no longer have permission/i],
      [ISSUE_2009_VISIBILITY_ERROR_CODES.notEditable, /can't be edited/i],
      [ISSUE_2009_VISIBILITY_ERROR_CODES.invalidReason, /10–200 characters/i],
    ];
    for (const [code, expected] of others) {
      // Same copy whether or not the event happens to be Private today.
      expect(issue2009VisibilityErrorCopy(code)).toMatch(expected);
      expect(issue2009VisibilityErrorCopyForLeg(code, "private")).toMatch(expected);
    }
  });

  it("still matches on a PostgREST-wrapped message, not just the bare code", () => {
    // Supabase surfaces the code inside a longer message. The editor forwards
    // `error.message` verbatim, so the map has to keep matching on inclusion —
    // for the exit leg too.
    const wrapped = `unexpected server error: ${PRIVATE_CODE} (SQLSTATE P0001)`;
    expect(issue2009VisibilityErrorCopy(wrapped)).toBe(APPROVED_ENTERING_COPY);
    expect(issue2009VisibilityErrorCopyForLeg(wrapped, "private")).toBe(
      ISSUE_2009_PRIVATE_EXIT_UNAVAILABLE_COPY,
    );
  });
});
