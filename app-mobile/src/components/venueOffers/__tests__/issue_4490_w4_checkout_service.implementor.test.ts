// @ts-nocheck
/**
 * #4490 Explorer W4 — the checkout service on the owner path (rules 1, 3).
 *
 *   V-1  `pay` and the plan's first payment always send channel "app", the
 *        user's session (no token field), and no amount or return URL
 *   V-2  tokens in `hold` / `membership_join` / reads are dropped, never kept
 *   V-3  `quote` sends the choice only: an amount smuggled into the body is removed
 *   V-4  a session that is not https Paystack or a full Stripe sheet is refused
 *
 * FAILS-ON-REVERT: drop `channel: "app"` and V-1 fails; return the hold answer
 * as is and V-2 fails.
 */
const mockInvokes: Array<{ fn: string; body: Record<string, unknown> }> = [];
let mockAnswer: (fn: string, body: Record<string, unknown>) => unknown = () => null;
jest.mock("../../../services/venuePurchaseService", () => {
  class VenuePurchaseError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    VenuePurchaseError,
    VENUE_READ_TIMEOUT_MS: 10000,
    invokeVenueFunction: async (fn: string, body: Record<string, unknown>) => {
      mockInvokes.push({ fn, body });
      return mockAnswer(fn, body);
    },
  };
});

import { parseVenuePaymentSession, venueOfferCheckoutService as svc } from "../../../services/venueOfferCheckoutService";

const GROUP = "00000000-4490-4000-8000-0000000004c9";
const SUB = "00000000-4490-4000-8000-0000000004ca";

beforeEach(() => {
  mockInvokes.length = 0;
  mockAnswer = () => null;
});

test("V-1 pay and the plan's first payment send channel app and nothing else of money or return", async () => {
  mockAnswer = () => ({ kind: "requires_redirect", provider: "paystack", authorizationUrl: "https://checkout.paystack.test/x", returnUrl: "https://host.usemingla.com/paid/visit/x" });
  const s = await svc.pay({ groupId: GROUP, expectedVersion: 2, idempotencyKey: "k-0001-abcdef", payMode: "deposit" });
  expect(s).toEqual({ provider: "paystack", authorizationUrl: "https://checkout.paystack.test/x" });
  expect(mockInvokes[0]).toEqual({
    fn: "venue-offers",
    body: { action: "pay", groupId: GROUP, expectedVersion: 2, idempotencyKey: "k-0001-abcdef", payMode: "deposit", channel: "app" },
  });
  await svc.memberPay({ subscriptionId: SUB, idempotencyKey: "k-0002-abcdef" });
  expect(mockInvokes[1]).toEqual({
    fn: "venue-membership-pay-link",
    body: { action: "pay", subscriptionId: SUB, idempotencyKey: "k-0002-abcdef", channel: "app" },
  });
  await svc.pay({ groupId: GROUP, expectedVersion: 2, idempotencyKey: "k-0003-abcdef", payMode: null });
  expect("payMode" in mockInvokes[2].body).toBe(false);
  for (const call of mockInvokes) expect("token" in call.body).toBe(false);
});

test("V-2 tokens are dropped from every answer", async () => {
  mockAnswer = () => ({ groupId: GROUP, state: "instant_payment_pending", bookingToken: "SECRET", token: "SECRET2" });
  const held = await svc.hold({ quoteId: "q", guest: { name: "Ada", email: "ada@example.com" }, cartKey: "c".repeat(32), idempotencyKey: "k-0004-abcdef" });
  expect(JSON.stringify(held)).not.toContain("SECRET");
  mockAnswer = () => ({ subscriptionId: SUB, status: "pending_payment", memberToken: "MSECRET" });
  const joined = await svc.membershipJoin({ planId: "p", member: { name: "Ada", email: "ada@example.com" }, startOn: null, cartKey: "c".repeat(32), idempotencyKey: "k-0005-abcdef" });
  expect(JSON.stringify(joined)).not.toContain("MSECRET");
  mockAnswer = () => ({ outcome: "confirmed", booking: { groupId: GROUP, bookingToken: "BSECRET" } });
  const confirmed = await svc.confirmReturn(GROUP);
  expect(JSON.stringify(confirmed)).not.toContain("BSECRET");
});

test("V-3 quote sends the choice only", async () => {
  await svc.quote({ body: { offeringId: "o", windowId: "w", lines: [], totalMinor: 1, amountMinor: 2, action: "hold" }, cartKey: "c".repeat(32), idempotencyKey: "k-0006-abcdef" });
  expect(mockInvokes[0].body).toEqual({ offeringId: "o", windowId: "w", lines: [], action: "quote", cartKey: "c".repeat(32), idempotencyKey: "k-0006-abcdef" });
});

test("V-4 only an https Paystack page or a complete Stripe sheet is a session", () => {
  expect(parseVenuePaymentSession({ kind: "requires_redirect", provider: "paystack", authorizationUrl: "http://insecure" })).toBeNull();
  expect(parseVenuePaymentSession({ kind: "requires_redirect", provider: "paystack", authorizationUrl: "javascript:alert(1)" })).toBeNull();
  expect(parseVenuePaymentSession({ kind: "requires_payment", provider: "stripe", clientSecret: "s" })).toBeNull();
  expect(parseVenuePaymentSession({ kind: "requires_payment", provider: "stripe", clientSecret: "s", publishableKey: "pk", stripeAccountId: "acct", amountMinor: "100", currencyCode: "USD" })).toEqual({
    provider: "stripe", clientSecret: "s", publishableKey: "pk", stripeAccountId: "acct", amountMinor: 100, currencyCode: "USD",
  });
  expect(parseVenuePaymentSession(null)).toBeNull();
});
