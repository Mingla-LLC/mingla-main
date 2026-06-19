// ORCH-1167 [event-page-canonical] — TESTER adversarial regression (IMMUTABLE).
//
// DIFFERENT ANGLE than the implementor's happy-path test (which proved the
// Σ-all-in running total in eventBoxTotals.ts — SC-3). This attacks the
// inline-box → cart pre-population SEED contract (SC-4) at its BOUNDARY +
// SECURITY edges: the `seed` query param that carries the buyer's inline-box
// selection from the public event page into the checkout cart step (i).
//
// The seed travels through an UNTRUSTED URL surface (a buyer can hand-edit
// `/checkout/<id>?seed=…`). The decoder MUST be hostile-input safe: it must
// NEVER inject a phantom line, a negative / zero / NaN / fractional quantity, an
// empty ticket id, or a duplicate-key blowup into the cart. And the encode→decode
// round-trip must be lossless for legitimate selections so the cart lands with
// EXACTLY the quantities the buyer picked (no silent drop / inflation → WYSIWYP
// integrity carries through to the cart, not just the box).
//
// FAILS-ON-REVERT (proven against commit 6eb1d0b8c — the ORCH-1167 implementation
// commit — by deleting the `&& qty > 0` guard and the `Number.isFinite(qty)` guard
// in decodeCartSeed (mingla-business/src/constants/publicUrls.ts): the
// "rejects zero / negative / NaN quantities" assertions below FAIL, because a
// hostile `seed=tier:-3` or `seed=tier:0` or `seed=tier:abc` would then leak a
// negative/zero/NaN line into the cart map. Restore → PASS. See the TEST report.

import { describe, expect, test } from "@jest/globals";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://business.usemingla.com",
      },
    },
  },
}));

import {
  decodeCartSeed,
  encodeCartSeed,
  checkoutPublicPathWithSeed,
} from "../publicUrls";

describe("ORCH-1167 cart-seed — hostile-input boundary (SC-4)", () => {
  test("round-trips a legitimate multi-tier selection losslessly", () => {
    const sel = { vip: 2, ga: 1, balcony: 5 };
    const encoded = encodeCartSeed(sel);
    expect(decodeCartSeed(encoded)).toEqual(sel);
  });

  test("drops zero-quantity tiers on ENCODE (only picked tiers travel)", () => {
    // A tier the buyer stepped down to 0 must not appear in the seed at all.
    expect(encodeCartSeed({ vip: 0, ga: 3 })).toBe("ga:3");
    expect(decodeCartSeed(encodeCartSeed({ vip: 0, ga: 3 }))).toEqual({ ga: 3 });
  });

  test("rejects NEGATIVE quantities (hostile hand-edited seed)", () => {
    // `?seed=vip:-3` must NOT leak a negative line that could credit the buyer.
    expect(decodeCartSeed("vip:-3")).toEqual({});
    expect(decodeCartSeed("vip:-3,ga:2")).toEqual({ ga: 2 });
  });

  test("rejects ZERO quantities", () => {
    expect(decodeCartSeed("vip:0")).toEqual({});
    expect(decodeCartSeed("vip:0,ga:1")).toEqual({ ga: 1 });
  });

  test("rejects NaN / non-numeric quantities", () => {
    expect(decodeCartSeed("vip:abc")).toEqual({});
    expect(decodeCartSeed("vip:,ga:2")).toEqual({ ga: 2 });
    expect(decodeCartSeed("vip:2.9")).toEqual({ vip: 2 }); // parseInt floors; never NaN
  });

  test("rejects empty / missing ticket ids", () => {
    expect(decodeCartSeed(":3")).toEqual({});
    expect(decodeCartSeed(",ga:2")).toEqual({ ga: 2 });
    expect(decodeCartSeed("ga:2,")).toEqual({ ga: 2 });
  });

  test("never throws on garbage / undefined / empty input", () => {
    expect(() => decodeCartSeed(undefined)).not.toThrow();
    expect(() => decodeCartSeed(null)).not.toThrow();
    expect(() => decodeCartSeed("")).not.toThrow();
    expect(() => decodeCartSeed("::::")).not.toThrow();
    expect(() => decodeCartSeed("garbage-no-colon")).not.toThrow();
    expect(decodeCartSeed(undefined)).toEqual({});
    expect(decodeCartSeed("garbage-no-colon")).toEqual({});
  });

  test("a totally hostile seed cannot inject ANY phantom line", () => {
    const hostile = "a:-1,b:0,c:abc,:9,d:,e:2.99,,::,f:1e9";
    const decoded = decodeCartSeed(hostile);
    // Only the two well-formed positive-int tiers survive (e floored to 2, f=1e9
    // parseInt → 1 then "e9" ignored). Every malformed tier is dropped, none
    // negative / zero / NaN / empty-id leaked.
    for (const [id, qty] of Object.entries(decoded)) {
      expect(id.length).toBeGreaterThan(0);
      expect(Number.isInteger(qty)).toBe(true);
      expect(qty).toBeGreaterThan(0);
    }
    expect(decoded).toEqual({ e: 2, f: 1 });
  });

  test("empty selection → bare checkout path (no ?seed=) ; SC-4 no-pick case", () => {
    expect(checkoutPublicPathWithSeed("evt_123", {})).toBe("/checkout/evt_123");
    expect(checkoutPublicPathWithSeed("evt_123", { vip: 0 })).toBe(
      "/checkout/evt_123",
    );
  });

  test("a real selection appends a URL-safe encoded seed", () => {
    const path = checkoutPublicPathWithSeed("evt_123", { vip: 2, ga: 1 });
    expect(path.startsWith("/checkout/evt_123?seed=")).toBe(true);
    // The seed survives a full URL round-trip (encode + decode the param).
    const seedParam = decodeURIComponent(path.split("?seed=")[1] ?? "");
    expect(decodeCartSeed(seedParam)).toEqual({ vip: 2, ga: 1 });
  });
});
