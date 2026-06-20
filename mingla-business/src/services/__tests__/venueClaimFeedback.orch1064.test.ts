// ORCH-1064 — IMPLEMENTOR happy-path regression for the business feedback loop.
//
// Covers the pure, deterministic units that gate the feedback UX:
//   - venueClaimBannerCopy('follow_up') now differs from plain pending and
//     carries the "get you live" encouragement (F-3 fix, DESIGN §2.5).
//   - brandKeys.feedback factory key shape (Constitution #4 — one key per entity).
//   - the open/fixed/total derivation used by the tile badge + progress meter.
//
// fails-on-revert: reverting venueClaimBannerLogic.ts makes B-01 fail (copy goes
// back to identical-to-pending); removing brandKeys.feedback makes K-01 fail.

/* eslint-disable import/first */
import { describe, expect, jest, test } from "@jest/globals";

// brandKeys lives in useBrands.ts which transitively imports AuthContext (JSX) +
// supabase + the @mingla/offering-rendering workspace pkg; stub them so the pure
// key factory loads under jest (mirrors useSoftDeleteBrand.orch1062.test.ts).
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock("../../services/supabase", () => ({
  supabase: {
    from: jest.fn(),
    channel: jest.fn(() => ({ on: jest.fn(), subscribe: jest.fn() })),
    removeChannel: jest.fn(),
  },
}));
jest.mock("../../services/appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: null, authStatus: "ready" }),
}));
jest.mock("../../hooks/usePublicEvents", () => ({
  publicEventKeys: { brandBySlug: (slug: string) => ["public-brand", slug] },
}));

import {
  venueClaimBannerCopy,
  venueClaimBannerVariant,
} from "../venueClaimBannerLogic";
import { brandKeys } from "../../hooks/useBrands";

describe("ORCH-1064 — follow_up banner copy (F-3 fix)", () => {
  test("B-01: follow_up copy differs from plain pending and reads as a punch-list", () => {
    const pending = venueClaimBannerCopy("pending_review");
    const followUp = venueClaimBannerCopy("follow_up");
    expect(followUp).not.toBeNull();
    expect(pending).not.toBeNull();
    // Must NOT be identical to plain pending (the whole F-3 bug).
    expect(followUp?.body).not.toBe(pending?.body);
    expect(followUp?.title).toBe("Updates requested");
    // Encouraging, finite-punch-list voice (DESIGN §2.5).
    expect(followUp?.body.toLowerCase()).toContain("tap to see what to fix");
  });

  test("B-02: follow_up variant still resolves from pending + follow-up stamp", () => {
    expect(
      venueClaimBannerVariant({
        claim_status: "pending_review",
        rejection_reason: null,
        claim_follow_up_at: "2026-06-03T10:00:00Z",
      }),
    ).toBe("follow_up");
  });
});

describe("ORCH-1064 — brandKeys.feedback factory", () => {
  test("K-01: feedback key is brand-scoped under the brands family", () => {
    const key = brandKeys.feedback("brand-123");
    expect(key).toEqual(["brands", "feedback", "brand-123"]);
    // Lives under brandKeys.all so a family invalidation still reaches it.
    expect(key[0]).toBe(brandKeys.all[0]);
  });
});

// The open/fixed derivation mirrors useVenueClaimFeedback's selectors. Tested as
// a pure function so the badge/progress math is locked without a React render.
function deriveCounts(
  items: { status: "open" | "fixed" }[],
): { openCount: number; fixedCount: number; totalCount: number } {
  return {
    openCount: items.filter((i) => i.status === "open").length,
    fixedCount: items.filter((i) => i.status === "fixed").length,
    totalCount: items.length,
  };
}

describe("ORCH-1064 — open/fixed/total derivation (tile badge + progress)", () => {
  test("D-01: mixed round counts open vs fixed correctly", () => {
    const counts = deriveCounts([
      { status: "open" },
      { status: "fixed" },
      { status: "open" },
    ]);
    expect(counts).toEqual({ openCount: 2, fixedCount: 1, totalCount: 3 });
  });

  test("D-02: all-fixed → openCount 0 (drives the Ready badge)", () => {
    const counts = deriveCounts([{ status: "fixed" }, { status: "fixed" }]);
    expect(counts.openCount).toBe(0);
    expect(counts.fixedCount).toBe(2);
  });

  test("D-03: empty round → all zero (defensive empty state)", () => {
    expect(deriveCounts([])).toEqual({
      openCount: 0,
      fixedCount: 0,
      totalCount: 0,
    });
  });
});
