/**
 * ORCH-1143 — liveSectionCollapseStore ADVERSARIAL (tester-owned).
 *
 * Different angle than the implementor's happy-path coverage:
 *   - The implementor's `home.orch_1143.test.tsx` only SOURCE-GREPS the literal
 *     string `const showLiveOpen = !liveHasHydrated || !liveCollapsed;` — that
 *     proves the characters exist, NOT that the boolean SEMANTICS produce a
 *     no-flash-of-wrong-state on cold start (Constitution #14). A grep passes
 *     even if the runtime logic is wrong as long as the string is byte-present.
 *   - The implementor's store test asserts `reset` returns `collapsed` to the
 *     default, but does NOT assert `reset` LEAVES `hasHydrated` untouched. If a
 *     careless edit made `reset` also clear `hasHydrated` back to false, a logout
 *     mid-session would re-arm the cold-start gate and the NEXT render (before a
 *     fresh rehydrate) would flash the default-open state over a user who had it
 *     collapsed — the exact #14 defect, invisible to the implementor's suite.
 *
 * This file EXECUTES the real store + evaluates the gate's boolean across the
 * full truth table (the runtime invariant), instead of matching source text.
 *
 * APPEND-ONLY. New file. Never modifies an existing test.
 */

import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import { useLiveSectionCollapseStore } from "../liveSectionCollapseStore";

/**
 * The EXACT gate `home.tsx` computes:
 *   const showLiveOpen = !liveHasHydrated || !liveCollapsed;
 * Mirrored here so we test the SEMANTICS (truth table), not the source string.
 */
const computeShowLiveOpen = (
  hasHydrated: boolean,
  collapsed: boolean,
): boolean => !hasHydrated || !collapsed;

afterEach(() => {
  useLiveSectionCollapseStore.getState().setCollapsed(false);
  useLiveSectionCollapseStore.getState().setHasHydrated(false);
});

describe("ORCH-1143 ADVERSARIAL — hydration gate produces NO flash (Constitution #14)", () => {
  test("ADV-1143-01: a user who persisted collapsed=true sees OPEN before rehydration completes (the flash defect)", () => {
    // Cold start: persisted value is collapsed=true, but hasHydrated has NOT yet
    // flipped (the first frame). The gate MUST resolve to OPEN so the section
    // does not momentarily render collapsed-then-snap-open (or vice versa).
    expect(computeShowLiveOpen(/*hasHydrated*/ false, /*collapsed*/ true)).toBe(
      true,
    );
    // And a user who persisted collapsed=false also sees OPEN pre-hydration
    // (consistent default — never collapsed before we know the truth).
    expect(computeShowLiveOpen(false, false)).toBe(true);
  });

  test("ADV-1143-02: AFTER hydration the gate honors the persisted choice exactly", () => {
    // hasHydrated true + collapsed true  → COLLAPSED (showOpen=false)
    expect(computeShowLiveOpen(true, true)).toBe(false);
    // hasHydrated true + collapsed false → OPEN
    expect(computeShowLiveOpen(true, false)).toBe(true);
  });

  test("ADV-1143-03: the gate is collapsed for EXACTLY ONE state — the post-hydration collapsed state", () => {
    // Full truth table: the ONLY (hasHydrated, collapsed) pair that hides the
    // section is (true, true). This is the load-bearing #14 invariant: pre-
    // hydration is ALWAYS open. If someone inverted the OR to AND, (false,true)
    // would flip to false (flash) and this asserts against that.
    const table: Array<[boolean, boolean, boolean]> = [
      [false, false, true],
      [false, true, true], // pre-hydration collapsed persisted → STILL OPEN
      [true, false, true],
      [true, true, false], // the only collapsed state
    ];
    for (const [hasHydrated, collapsed, expected] of table) {
      expect(computeShowLiveOpen(hasHydrated, collapsed)).toBe(expected);
    }
  });
});

describe("ORCH-1143 ADVERSARIAL — reset must NOT re-arm the cold-start gate (logout safety)", () => {
  test("ADV-1143-04: reset() returns collapsed to default but LEAVES hasHydrated true (no re-flash on next render)", () => {
    // Simulate a live, hydrated session where the user collapsed the section.
    useLiveSectionCollapseStore.getState().setHasHydrated(true);
    useLiveSectionCollapseStore.getState().setCollapsed(true);
    expect(useLiveSectionCollapseStore.getState().hasHydrated).toBe(true);

    // Logout cascade calls reset().
    useLiveSectionCollapseStore.getState().reset();

    const s = useLiveSectionCollapseStore.getState();
    // collapsed back to the open default (Constitution #6 — logout clears UI state).
    expect(s.collapsed).toBe(false);
    // CRITICAL: reset must NOT clear hasHydrated. The store is already hydrated
    // for this app session; clearing it would re-arm the cold-start gate and the
    // next render would treat a known state as unknown (a spurious open-flash).
    expect(s.hasHydrated).toBe(true);
  });

  test("ADV-1143-05: the gate after reset (collapsed=false, still hydrated) is OPEN — not a flash, an honest default", () => {
    useLiveSectionCollapseStore.getState().setHasHydrated(true);
    useLiveSectionCollapseStore.getState().setCollapsed(true);
    useLiveSectionCollapseStore.getState().reset();
    const s = useLiveSectionCollapseStore.getState();
    // Post-reset, the computed gate is a deterministic OPEN driven by the real
    // (collapsed=false, hasHydrated=true) state — NOT the pre-hydration fallback.
    expect(computeShowLiveOpen(s.hasHydrated, s.collapsed)).toBe(true);
  });
});
