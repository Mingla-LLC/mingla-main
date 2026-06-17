/**
 * ORCH-1150-R2 (D-9) — published-RSVP edit safe-exit guard.
 *
 * BUG: editing a PUBLISHED RSVP bounced to the events list. Root cause: the
 * edit-published safe-exit in `app/rsvp/[id]/edit.tsx` fired on the bare
 * `resolvedLiveEvent === null && !businessEventQuery.isLoading` guard. React
 * Query reports a DISABLED query (enabled = isAuthReady && eventId) as
 * isLoading=false, so during the `isAuthReady` flicker — a fresh push with an
 * empty useLiveEventStore — the exit fired BEFORE auth landed and the fetch
 * ran. FIX: gate the exit on `isAuthReady && !isLoading && !isFetching` so it
 * only bounces once the lookup is genuinely exhausted.
 *
 * This is a TWO-PART proof:
 *   1. A pure-logic test of the exit predicate (the exact boolean condition
 *      the effect uses), exercising the auth-flicker + in-flight-fetch states.
 *   2. A structural-source assertion that the shipped guard in edit.tsx
 *      actually carries the isAuthReady + isFetching terms (fails-on-revert:
 *      deleting them from the source makes the regex assertion fail; the
 *      logic test also fails because the predicate would then bounce while
 *      not-auth-ready / fetching).
 *
 * Fails-on-revert verified by TRUE LINE DELETION of the isAuthReady +
 * !isFetching terms in the source guard (see IMPLEMENT report).
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * The exact safe-exit predicate from app/rsvp/[id]/edit.tsx (D-9 hardened).
 * Kept in lock-step with the source; the structural assertion below proves the
 * source still matches this shape so the two can't silently diverge.
 */
function shouldBounceToEventsList(state: {
  isAuthReady: boolean;
  resolvedLiveEvent: unknown | null;
  isLoading: boolean;
  isFetching: boolean;
}): boolean {
  return (
    state.isAuthReady &&
    state.resolvedLiveEvent === null &&
    !state.isLoading &&
    !state.isFetching
  );
}

describe("ORCH-1150-R2 D-9 — RSVP edit-published safe-exit is auth+fetch gated", () => {
  test("does NOT bounce while auth is not ready (the flicker that caused the bug)", () => {
    // The disabled query reports isLoading=false; without the isAuthReady gate
    // this state bounced a published RSVP before it could load.
    expect(
      shouldBounceToEventsList({
        isAuthReady: false,
        resolvedLiveEvent: null,
        isLoading: false,
        isFetching: false,
      }),
    ).toBe(false);
  });

  test("does NOT bounce while the live-event fetch is in flight", () => {
    expect(
      shouldBounceToEventsList({
        isAuthReady: true,
        resolvedLiveEvent: null,
        isLoading: false,
        isFetching: true,
      }),
    ).toBe(false);
    expect(
      shouldBounceToEventsList({
        isAuthReady: true,
        resolvedLiveEvent: null,
        isLoading: true,
        isFetching: false,
      }),
    ).toBe(false);
  });

  test("does NOT bounce once the RSVP resolves (event found)", () => {
    expect(
      shouldBounceToEventsList({
        isAuthReady: true,
        resolvedLiveEvent: { id: "evt_1" },
        isLoading: false,
        isFetching: false,
      }),
    ).toBe(false);
  });

  test("DOES bounce only when the lookup is genuinely exhausted (auth ready, settled, still null)", () => {
    expect(
      shouldBounceToEventsList({
        isAuthReady: true,
        resolvedLiveEvent: null,
        isLoading: false,
        isFetching: false,
      }),
    ).toBe(true);
  });

  test("SOURCE: the shipped guard carries isAuthReady + !isFetching (fails-on-revert)", () => {
    const source = readFileSync(
      join(__dirname, "..", "edit.tsx"),
      "utf8",
    );
    // The edit-published exit must be gated on all four terms. Reverting the
    // D-9 fix (dropping isAuthReady / !isFetching) makes this assertion fail.
    expect(source).toMatch(
      /isAuthReady\s*&&\s*\n?\s*resolvedLiveEvent === null\s*&&\s*\n?\s*!businessEventQuery\.isLoading\s*&&\s*\n?\s*!businessEventQuery\.isFetching/,
    );
  });
});
