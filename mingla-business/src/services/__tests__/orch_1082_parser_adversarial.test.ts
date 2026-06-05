/* eslint-disable import/first */
/**
 * ORCH-1082 [business notification deep-link handlers] — TESTER adversarial
 * regression (CLIENT parser, malformed/edge-case angle).
 *
 * Distinct from BOTH implementor tests:
 *   - The implementor Jest test (businessNotificationRouting.test.ts) asserts the
 *     HAPPY-PATH exact path strings for well-formed deep links.
 *   - The implementor Deno test (orch_1082_push_app_routing.test.ts) attacks the
 *     backend DELIVERY TARGET (which OneSignal app receives the push).
 *
 * THIS test attacks the parser's GRACEFUL-DEGRADATION contract under MALFORMED
 * input: empty paths, trailing/duplicate slashes, the `payments` HEAD vs the
 * `brand/{id}/payments` SUB confusion, partial/garbage `partner` paths, deeper
 * sub-paths than handled, and the bare `payments` head with NO brand context.
 * The bug class this guards: a malformed deep_link that throws (crashes the tap
 * handler) or silently mis-routes to the wrong screen. Per SC-15.3 / SC-17.5 /
 * Constitution #3 (no silent failures), every malformed input must either return
 * a real path or null (→ NAV_TARGETS fallback), and NEVER throw.
 *
 * Append-only — does not modify the implementor's test file.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

let mockBrandId: string | null = "brand-CTX";
jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: {
    getState: () => ({ currentBrandId: mockBrandId }),
  },
}));
jest.mock("../supabase", () => ({
  supabase: { from: jest.fn(() => ({ update: jest.fn(() => ({ eq: jest.fn(() => ({ then: (cb: () => void) => cb() })) })) })) },
}));
jest.mock("../mixpanelService", () => ({ mixpanelService: { track: jest.fn() } }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import {
  parseBusinessDeepLink,
  resolveBusinessNavTarget,
} from "../businessNotificationRouting";

beforeEach(() => {
  mockBrandId = "brand-CTX";
});

describe("ORCH-1082 parser adversarial — malformed input lands gracefully (never throws, never mis-routes)", () => {
  // ── never throws on garbage ────────────────────────────────────────────────
  const garbage = [
    "",
    "mingla-business://",
    "mingla-business:///",
    "mingla-business://brand",
    "mingla-business://brand/",
    "mingla-business://partner",
    "mingla-business://partner/",
    "mingla-business://payments/onboard",
    "https://example.com/evil",
    "mingla-business://brand/B/payments/onboard/extra/segments",
    "MINGLA-BUSINESS://brand/B/payments/onboard",
  ];
  test.each(garbage)("does not throw on %p", (input) => {
    expect(() => parseBusinessDeepLink(input)).not.toThrow();
  });

  // ── Gap 15 boundary: bare `payments` HEAD vs `brand/{id}/payments` SUB ──────
  test("the `payments` HEAD case (no brand in path) is distinct from the `brand/{id}/payments` SUB", () => {
    // HEAD `payments` resolves via current-brand context, not via rest[].
    expect(parseBusinessDeepLink("mingla-business://payments")).toBe(
      "/brand/brand-CTX/payments",
    );
    // SUB `brand/{id}/payments` uses the path id, NOT the context id — must not
    // leak the context brand into a path-id route.
    expect(parseBusinessDeepLink("mingla-business://brand/B/payments")).toBe(
      "/brand/B/payments",
    );
    expect(parseBusinessDeepLink("mingla-business://brand/B/payments/onboard")).toBe(
      "/brand/B/payments/onboard",
    );
  });

  test("bare `payments` HEAD with NO brand context falls to the account tab, never crashes", () => {
    mockBrandId = null;
    expect(parseBusinessDeepLink("mingla-business://payments")).toBe(
      "/(tabs)/account",
    );
  });

  // ── Gap 15: a deeper-than-handled payments leaf must NOT be treated as onboard ─
  test("an unrecognized payments leaf (not `onboard`) collapses to the payments hub, not onboarding", () => {
    // rest = ["payments","settings"] → rest[2] is undefined → NOT "onboard" → hub.
    expect(parseBusinessDeepLink("mingla-business://brand/B/payments/settings")).toBe(
      "/brand/B/payments",
    );
    // A garbage 4th segment must still not escalate to onboarding.
    expect(
      parseBusinessDeepLink("mingla-business://brand/B/payments/onboard/x"),
    ).toBe("/brand/B/payments/onboard");
  });

  // ── Gap 17b: partner head graceful degradation ─────────────────────────────
  test("partner head only maps `earnings`; any other/missing sub returns null (→ fallback), never a fabricated route", () => {
    expect(parseBusinessDeepLink("mingla-business://partner/earnings")).toBe(
      "/partner/earnings",
    );
    expect(parseBusinessDeepLink("mingla-business://partner/payouts")).toBeNull();
    expect(parseBusinessDeepLink("mingla-business://partner")).toBeNull();
    expect(parseBusinessDeepLink("mingla-business://partner/")).toBeNull();
  });

  // ── re-prefix regression: the OLD dead deep link still degrades safely ──────
  test("the OLD account/partner-earnings deep link (now removed) returns null → NAV_TARGETS fallback, no crash", () => {
    // `account` is an unhandled head → null → resolveBusinessNavTarget falls back.
    expect(
      parseBusinessDeepLink("mingla-business://account/partner-earnings"),
    ).toBeNull();
  });

  // ── end-to-end: a stripe.partner_detach_completed with the NEW deep link routes
  //    to /partner/earnings; with NO deep link the stripe.* fallback → payments ─
  test("resolveBusinessNavTarget: stripe.partner_detach_completed honors the new deep link, falls back to payments without one", () => {
    expect(
      resolveBusinessNavTarget({
        type: "stripe.partner_detach_completed",
        deepLink: "mingla-business://partner/earnings",
      }),
    ).toBe("/partner/earnings");
    // No deepLink → stripe.* fallback → payments (current-brand context).
    expect(
      resolveBusinessNavTarget({ type: "stripe.partner_detach_completed" }),
    ).toBe("/brand/brand-CTX/payments");
  });

  // ── leading-slash normalization must not change Gap-15/17b outcomes ─────────
  test("leading slashes after the scheme are normalized and do not break the new branches", () => {
    expect(
      parseBusinessDeepLink("mingla-business:///brand/B/payments/onboard"),
    ).toBe("/brand/B/payments/onboard");
    expect(parseBusinessDeepLink("mingla-business:///partner/earnings")).toBe(
      "/partner/earnings",
    );
  });
});
