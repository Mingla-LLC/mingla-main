/**
 * ORCH-1145 — TESTER-OWNED ADVERSARIAL RUNTIME GATE (immutable / append-only).
 *
 * DIFFERENT ANGLE from the implementor's `venueTab.contract.test.ts` (T-1..T-10),
 * which is entirely SOURCE-STRING matching — it never EXECUTES the visibility
 * gate. A `&&` typo (instead of `||`), a swapped flag, or a wrong push order
 * would slip past a regex `/hasPhysicalLocation \|\| hasPlacePool/` check while
 * silently breaking the real runtime behavior the SPEC §5/§6 invariant
 * I-PROPOSED-1145-VENUE-TAB-CONDITIONAL actually promises.
 *
 * This file RUNS `deriveHubVisibleTabs` and `pickHubInitialTab` as pure
 * functions and attacks two boundaries the implementor's tests do NOT cover:
 *
 *   (A) The placePool-ONLY brand (hasPhysicalLocation=false, hasPlacePool=true)
 *       MUST still surface the venue pill — proves the gate is a true OR, not an
 *       AND. (SPEC T-2; only string-matched upstream, never executed.)
 *
 *   (B) STORED-TAB STALE-POINTER RACE (entirely uncovered upstream): a user who
 *       last sat on the Venue tab, then the brand's venue flag flips OFF (venue
 *       no longer in visibleTabs), MUST NOT be restored onto a now-invisible
 *       Venue tab. `pickHubInitialTab("venue", [...no venue...])` must fall back
 *       to events / first-visible, never return "venue". A naive
 *       `if (storedTab === "venue") return "venue"` (ignoring the
 *       visibleTabs.includes guard) would strand the user on a dead tab whose
 *       route the layout would then `router.replace` away from — a flicker/bounce
 *       regression. This is the exact failure class the conditional gate exists
 *       to prevent.
 *
 * FAILS-ON-REVERT: proven against commit 1e2a3badcee4d805922d2f422eb5c880c3444562
 * (the implementation). Reverting the venue append/condition in
 * deriveHubVisibleTabs (case A) OR dropping the `visibleTabs.includes(storedTab)`
 * guard in pickHubInitialTab (case B) flips assertions here to FAIL. See the
 * TEST report for the recorded revert-proof.
 *
 * APPEND-ONLY — do not weaken or delete existing assertions.
 */
import { describe, expect, jest, test } from "@jest/globals";

// Neutralize the RN/native + data-layer imports the module graph pulls in
// (AsyncStorage directly; supabase/AuthContext via ./useBrandOfferingCounts) so
// the PURE functions can be exercised under the node/ts-jest env.
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
  pickHubInitialTab,
  type HubTabName,
} from "../useHubTabs";

const counts = (
  events: number,
  trips: number,
  experiences: number,
): { events: number; trips: number; experiences: number } => ({
  events,
  trips,
  experiences,
});

describe("ORCH-1145 adversarial — deriveHubVisibleTabs is a TRUE OR, executed at runtime", () => {
  test("A1 — placePool-ONLY brand (physical=false) STILL gets the venue pill (OR, not AND)", () => {
    const out = deriveHubVisibleTabs(counts(0, 0, 0), {
      hasPhysicalLocation: false,
      hasPlacePool: true,
    });
    expect(out).toEqual(["venue"]);
    // If the gate were `&&`, this would be [] — guard the AND-typo explicitly.
    expect(out).toContain("venue");
  });

  test("A2 — physical-location-ONLY brand (pool=false) STILL gets the venue pill", () => {
    const out = deriveHubVisibleTabs(counts(0, 0, 0), {
      hasPhysicalLocation: true,
      hasPlacePool: false,
    });
    expect(out).toEqual(["venue"]);
  });

  test("A3 — purely-online brand (neither flag) NEVER gets the venue pill (false case)", () => {
    const out = deriveHubVisibleTabs(counts(3, 2, 1), {
      hasPhysicalLocation: false,
      hasPlacePool: false,
    });
    expect(out).not.toContain("venue");
    expect(out).toEqual(["events", "trips", "experiences"]);
  });

  test("A4 — default venue arg (no second arg) excludes venue — older callers safe", () => {
    const out = deriveHubVisibleTabs(counts(1, 0, 0));
    expect(out).not.toContain("venue");
    expect(out).toEqual(["events"]);
  });

  test("A5 — venue is appended LAST, after every offering pill (rightmost peer order)", () => {
    const out = deriveHubVisibleTabs(counts(1, 1, 1), {
      hasPhysicalLocation: true,
      hasPlacePool: false,
    });
    expect(out).toEqual(["events", "trips", "experiences", "venue"]);
    expect(out.indexOf("venue")).toBe(out.length - 1);
  });
});

describe("ORCH-1145 adversarial — stored-tab STALE-POINTER race (flag flips off)", () => {
  test("B1 — last-on-venue + venue flag flipped OFF → does NOT restore venue (falls to events)", () => {
    // The brand lost its venue (flag flipped off): visibleTabs no longer has it.
    const visible: HubTabName[] = ["events", "trips"];
    const restored = pickHubInitialTab("venue", visible);
    expect(restored).not.toBe("venue");
    expect(restored).toBe("events");
  });

  test("B2 — last-on-venue + venue flag flipped OFF, no events either → first visible, never venue", () => {
    const visible: HubTabName[] = ["trips", "experiences"];
    const restored = pickHubInitialTab("venue", visible);
    expect(restored).not.toBe("venue");
    expect(restored).toBe("trips");
  });

  test("B3 — last-on-venue WHILE still visible → correctly restores venue", () => {
    const visible: HubTabName[] = ["events", "venue"];
    expect(pickHubInitialTab("venue", visible)).toBe("venue");
  });

  test("B4 — venue is the ONLY visible tab and it was the stored tab → restores venue", () => {
    const visible: HubTabName[] = ["venue"];
    expect(pickHubInitialTab("venue", visible)).toBe("venue");
  });

  test("B5 — empty visibleTabs (no offerings, no venue) → null, no phantom venue", () => {
    expect(pickHubInitialTab("venue", [])).toBeNull();
  });
});
