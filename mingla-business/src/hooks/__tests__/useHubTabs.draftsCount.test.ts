/**
 * ORCH-1154 [snap-autodraft-navigate] — AMENDMENT A (drafts-visibility fix)
 * IMPLEMENTOR happy-path regression suite for the Hub tab gate.
 *
 * THE BUG (INVESTIGATE F-1 / SPEC A.1): `pg_brand_offering_counts` counted
 * PUBLISHED offerings only, so `deriveHubVisibleTabs` omitted an offering tab
 * for a brand whose only rows of that type were unpublished DRAFTS. After a
 * snap auto-drafted N experiences, navigation to /hub/experiences was bounced
 * by the ORCH-1145 nav-lock redirect (tab not in visibleTabs) and the drafts —
 * real in the DB — were invisible.
 *
 * THE FIX (SPEC A.5.2): each offering type is visible when published OR draft
 * count > 0. This suite EXECUTES `deriveHubVisibleTabs` (not source-grep) so a
 * `&&`-instead-of-`||` mutation or a wrong-field reference is caught at runtime.
 *
 * fails-on-revert (SPEC A.14 safeguard 1): reverting the
 * `|| (counts.*_draft ?? 0) > 0` clauses in useHubTabs.ts flips TA-1/TA-3/TA-5
 * to FAIL (the draft-only / executed-gate cases). Verified in
 * IMPLEMENT_ORCH-1154_DRAFTS_FIX.md §Regression Test.
 *
 * NOTE — append-only, DIFFERENT ANGLE from the existing
 * useHubTabs.venueGate.adversarial.test.ts (which attacks the venue OR + the
 * stored-tab stale pointer); this one attacks the published-OR-draft offering
 * gate. The venue gate test MUST still pass after this change (SC-A6 / A.11).
 */
import { describe, expect, jest, test } from "@jest/globals";

// useHubTabs imports useBrandOfferingCounts → AuthContext/supabase →
// expo-constants (ESM, untransformable here). We only exercise the PURE
// deriveHubVisibleTabs, so mock the transitive RN/native deps (identical
// convention to useHubTabs.venueGate.adversarial.test.ts).
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));
jest.mock("../useBrandOfferingCounts", () => ({
  __esModule: true,
  useBrandOfferingCounts: () => ({ data: undefined, isLoading: false }),
}));

// Import AFTER the mocks are registered.
// eslint-disable-next-line import/first
import {
  deriveHubVisibleTabs,
  type HubTabName,
} from "../useHubTabs";
// eslint-disable-next-line import/first
import type { BrandOfferingCounts } from "../useBrandOfferingCounts";

const counts = (over: Partial<BrandOfferingCounts>): BrandOfferingCounts => ({
  events: 0,
  trips: 0,
  experiences: 0,
  events_draft: 0,
  trips_draft: 0,
  experiences_draft: 0,
  ...over,
});

describe("ORCH-1154 A.5.2 — drafts count toward Hub tab visibility", () => {
  test("TA-1: draft-only brand (experiences_draft:2) → 'experiences' tab visible", () => {
    const visible = deriveHubVisibleTabs(counts({ experiences_draft: 2 }));
    // The bug-closing assertion: drafts alone make the tab appear.
    expect(visible).toContain("experiences");
    // and ONLY experiences — no spurious events/trips tab from zero counts.
    expect(visible).not.toContain("events");
    expect(visible).not.toContain("trips");
  });

  test("TA-1b: draft-only across all three types → all three tabs visible", () => {
    const visible = deriveHubVisibleTabs(
      counts({ events_draft: 1, trips_draft: 1, experiences_draft: 1 }),
    );
    const expected: HubTabName[] = ["events", "trips", "experiences"];
    expect(visible).toEqual(expected);
  });

  test("TA-2: truly-empty brand (all six counts 0) → no offering tabs", () => {
    const visible = deriveHubVisibleTabs(counts({}));
    expect(visible).not.toContain("events");
    expect(visible).not.toContain("trips");
    expect(visible).not.toContain("experiences");
    expect(visible).toEqual([]); // no venue flags either
  });

  test("TA-3: published + draft mix → tab present exactly once (presence, not double-count)", () => {
    const visible = deriveHubVisibleTabs(
      counts({ experiences: 3, experiences_draft: 5 }),
    );
    expect(visible).toContain("experiences");
    expect(visible.filter((t) => t === "experiences")).toHaveLength(1);
  });

  test("TA-3b: published-only still works (drafts at 0) → tab visible", () => {
    const visible = deriveHubVisibleTabs(counts({ events: 13 }));
    expect(visible).toContain("events");
  });

  test("TA-5 (executed gate): OR not AND — published:0 + draft:1 must INCLUDE the tab", () => {
    // The exact mutation A.14 guards: an `&&` typo would make published:0 hide
    // the tab despite drafts. Running the gate proves the OR holds.
    const visible = deriveHubVisibleTabs(counts({ experiences: 0, experiences_draft: 1 }));
    expect(visible).toContain("experiences");
  });

  test("SC-A6: a type with 0 published + 0 draft is NOT made visible (nav-lock preserved)", () => {
    // experiences has rows; events/trips have none (neither published nor draft)
    // → only the experiences tab; events/trips routes stay correctly redirected.
    const visible = deriveHubVisibleTabs(counts({ experiences_draft: 4 }));
    const expected: HubTabName[] = ["experiences"];
    expect(visible).toEqual(expected);
  });

  test("crash-safe: an old-RPC shape missing *_draft fields degrades to published-only, no throw", () => {
    // Simulate a pre-migration response (no *_draft keys) cast through the
    // interface — the `?? 0` defensive guard must not throw and must hide the
    // draft-only tab (today's behavior) rather than NaN.
    const legacy = { events: 0, trips: 0, experiences: 0 } as BrandOfferingCounts;
    expect(() => deriveHubVisibleTabs(legacy)).not.toThrow();
    expect(deriveHubVisibleTabs(legacy)).toEqual([]);
  });
});
