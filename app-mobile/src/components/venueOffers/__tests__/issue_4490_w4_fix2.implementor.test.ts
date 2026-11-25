/* eslint-disable @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * #4490 spec 06 W4 fix 2 (W4-D1) — the pure parts of a lost session.
 *
 *   F-1 the reducer: "session gone" answers on quote / hold / join / pay
 *       (`auth_invalid`, `auth_session_missing`, `booking_token_required`,
 *       `membership_token_required`) are the signed_out phase, not the generic
 *       error; other codes are unchanged
 *   F-2 the app's own sign-out (`session_lost`) from any unfinished phase is
 *       signed_out with the step that was in flight; finished phases stay
 *   F-3 resuming signed_out: step 1 when nothing was priced, Review when a
 *       quote or a booking exists (keys kept)
 *   F-4 the kept checkout expires 30 minutes after it was kept; another
 *       account drops it
 *   F-5 a signed-in route goes back to the start only when its account signs
 *       out (never for a stranger who was never signed in)
 *   F-6 the venue route and the Purchases detail use that rule; a signed-out
 *       Purchases venue detail never says "isn't on your account"
 *   F-7 (W4-R1) the booking read's fullNowReason reaches "Pay to hold your
 *       date" only when the server offers no deposit; unknown values are dropped
 *
 * FAILS-ON-REVERT: drop VENUE_SESSION_LOST_CODES from step_failed and F-1
 * fails; drop the expiry and F-4 fails; drop the hook from the routes and F-6
 * fails.
 */
import fs from "fs";
import path from "path";

jest.mock("expo-router", () => ({ useRouter: () => ({}) }));
jest.mock("../../../store/appStore", () => ({ useAppStore: () => null }));

const flow = require("../../../payments/venueOfferCheckoutFlow");
const resume = require("../venueCheckoutResume");
const { returnToStart, signedOutSince } = require("../../../hooks/useReturnToStartOnSignOut");

const base = () => flow.initialVenueCheckoutState("entry", "c".repeat(32));
const QUOTE = { quoteId: "q-1", currencyCode: "NGN", totalMinor: 645000, payModes: ["full"], depositMinor: null };
const BOOKING = { id: "g-1", version: 1, state: "instant_payment_pending", totalMinor: 645000, amountDueNowMinor: 645000, holdUntil: null };
const fail = (s, step, code) => flow.venueOfferCheckoutReducer(s, { type: "step_failed", step, code, venueName: "Gameland" });

function quoting() {
  let s = flow.venueOfferCheckoutReducer(base(), { type: "choose", choice: "c1" });
  s = flow.venueOfferCheckoutReducer(s, { type: "quote_start", freshKey: "k-quote-0001" });
  return s;
}
function holding() {
  let s = flow.venueOfferCheckoutReducer(quoting(), { type: "quote_ok", quote: QUOTE });
  s = flow.venueOfferCheckoutReducer(s, { type: "hold_start", freshKey: "k-hold-00001", guest: "g" });
  return s;
}
function paying() {
  let s = flow.venueOfferCheckoutReducer(holding(), { type: "hold_ok", booking: BOOKING, mode: "instant" });
  s = flow.venueOfferCheckoutReducer(s, { type: "pay_start", freshKey: "k-pay-000001" });
  return s;
}

describe("F-1 session-gone answers are not the generic error", () => {
  test.each(["auth_invalid", "auth_session_missing", "booking_token_required", "membership_token_required"])("%s", (code) => {
    for (const [step, s] of [["quote", quoting()], ["hold", holding()], ["pay", paying()]]) {
      const next = fail(s, step, code);
      expect(next.phase).toBe("signed_out");
      expect(next.failedStep).toBe(step);
      expect(next.notice).toBeNull();
      expect(flow.isVenueCheckoutBusy(next)).toBe(false);
    }
  });
  test("other codes still read the generic line", () => {
    const next = fail(quoting(), "quote", "offer_request_failed");
    expect(next.phase).toBe("error");
    expect(next.notice.message).toBe("Something went wrong. Try again.");
  });
  test("a join (plan) answered auth_invalid", () => {
    let s = flow.initialVenueCheckoutState("plan", "c".repeat(32));
    s = flow.venueOfferCheckoutReducer(s, { type: "choose", choice: "plan-1" });
    s = flow.venueOfferCheckoutReducer(s, { type: "join_start", freshKey: "k-join-00001", guest: "g" });
    expect(fail(s, "join", "auth_invalid")).toMatchObject({ phase: "signed_out", failedStep: "join" });
  });
});

describe("F-2 the app's own sign-out with the sheet open", () => {
  test("in-flight steps record the step; idle Review records none; finished phases stay", () => {
    expect(flow.venueOfferCheckoutReducer(quoting(), { type: "session_lost" })).toMatchObject({ phase: "signed_out", failedStep: "quote" });
    expect(flow.venueOfferCheckoutReducer(paying(), { type: "session_lost" })).toMatchObject({ phase: "signed_out", failedStep: "pay" });
    const review = flow.venueOfferCheckoutReducer(quoting(), { type: "quote_ok", quote: QUOTE });
    expect(flow.venueOfferCheckoutReducer(review, { type: "session_lost" })).toMatchObject({ phase: "signed_out", failedStep: null });
    const booked = { ...paying(), phase: "booked" };
    expect(flow.venueOfferCheckoutReducer(booked, { type: "session_lost" })).toBe(booked);
    const requested = { ...paying(), phase: "requested" };
    expect(flow.venueOfferCheckoutReducer(requested, { type: "session_lost" })).toBe(requested);
  });
});

describe("F-3 resuming a signed_out checkout", () => {
  test("nothing priced → step 1; a quote → Review (same keys); a booking → Review", () => {
    const q = flow.resumedVenueCheckoutState(fail(quoting(), "quote", "auth_invalid"));
    expect(q.phase).toBe("choosing");
    expect(q.choice).toBe("c1");
    const h = flow.resumedVenueCheckoutState(fail(holding(), "hold", "auth_invalid"));
    expect(h.phase).toBe("review");
    expect(h.keys.hold.key).toBe("k-hold-00001");
    const p = flow.resumedVenueCheckoutState(fail(paying(), "pay", "auth_invalid"));
    expect(p).toMatchObject({ phase: "review", booking: { id: "g-1" }, failedStep: null, notice: null });
    expect(flow.venueCheckoutProgress(fail(quoting(), "quote", "auth_invalid"))).toBe(1);
  });
});

describe("F-4 the kept checkout's lifetime", () => {
  const snap = (accountId = "u-1") => ({
    accountId,
    route: "/b/x/v/y?tab=entry",
    homeKey: "venue:x:y:entry",
    open: {},
    state: base(),
    choice: null,
    review: null,
    planDue: null,
    guest: { name: "", email: "", phone: "" },
  });
  afterEach(() => resume.dropVenueCheckout());
  test("29 minutes later it comes back; 31 minutes later it is gone", () => {
    resume.holdVenueCheckout(snap(), 1_000_000);
    expect(resume.venueCheckoutRouteAfterSignIn("u-1", 1_000_000 + 29 * 60_000)).toBe("/b/x/v/y?tab=entry");
    expect(resume.takeVenueCheckout("u-1", "venue:x:y:entry", 1_000_000 + 31 * 60_000)).toBeNull();
    expect(resume.heldVenueCheckoutForTests()).toBeNull();
    expect(resume.KEPT_FOR_MS).toBe(30 * 60 * 1000);
  });
  test("another account drops it", () => {
    resume.holdVenueCheckout(snap(), 0);
    expect(resume.venueCheckoutRouteAfterSignIn("u-2", 10)).toBeNull();
    expect(resume.takeVenueCheckout("u-1", "venue:x:y:entry", 10)).toBeNull();
  });
});

describe("F-5 a signed-in screen does not outlive its account", () => {
  test("only signed-in → signed-out moves", () => {
    expect(signedOutSince("u-1", null)).toBe(true);
    expect(signedOutSince(null, null)).toBe(false);
    expect(signedOutSince("u-1", "u-1")).toBe(false);
    expect(signedOutSince(null, "u-1")).toBe(false);
  });
  test("back to the root: dismiss the pushed routes, or replace with the root", () => {
    const calls = [];
    returnToStart({ canGoBack: () => true, dismissAll: () => calls.push("dismissAll"), replace: (p) => calls.push(`replace:${p}`) });
    returnToStart({ canGoBack: () => false, dismissAll: () => calls.push("dismissAll"), replace: (p) => calls.push(`replace:${p}`) });
    expect(calls).toEqual(["dismissAll", "replace:/"]);
    expect(() => returnToStart({ canGoBack: () => { throw new Error("x"); } })).not.toThrow();
  });
});

describe("F-6 the routes W4's checkout lives on", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "../../../..", p), "utf8");
  test("the venue route and the Purchases detail return to the start on sign-out", () => {
    for (const file of ["app/b/[brandSlug]/v/[venueSlug].tsx", "app/purchases/[kind]/[id].tsx"]) {
      const src = read(file);
      expect(src).toMatch(/import \{ useReturnToStartOnSignOut \} from "[./]+\/src\/hooks\/useReturnToStartOnSignOut";/);
      expect(src).toMatch(/\n {2}useReturnToStartOnSignOut\(\);\n/);
    }
  });
  test("a signed-out Purchases venue detail is checked before 'isn't on your account'", () => {
    const src = read("app/purchases/[kind]/[id].tsx");
    const signedOut = src.indexOf("userId === null && isVenuePurchaseKind(kind)");
    const missing = src.indexOf("item === null && isVenuePurchaseKind(kind)");
    expect(signedOut).toBeGreaterThan(0);
    expect(signedOut).toBeLessThan(missing);
  });
});

describe("F-7 the server's reason everything is due now (W4-R1)", () => {
  const purchases = require("../../purchases/venuePurchaseModel");
  const row = (over = {}) => ({
    groupId: "00000000-4490-4000-8000-0000000004f7",
    reference: "VB-1",
    state: "approved_payment_required",
    offerKind: "private_hire",
    currencyCode: "NGN",
    totalMinor: 308000000,
    totalDueMinor: 308000000,
    amountDueNowMinor: 308000000,
    paidMinor: 0,
    paymentCollection: "mingla",
    payModes: [{ mode: "full", amountMinor: 308000000 }],
    fullNowReason: "balance_due_passed",
    venue: { id: "v", name: "Gameland QA", timezone: "Africa/Lagos" },
    lines: [],
    passes: [],
    ...over,
  });
  test("parsed and passed to Pay to hold your date", () => {
    const b = purchases.parseVenueBooking(row());
    expect(b.fullNowReason).toBe("balance_due_passed");
    expect(purchases.venueBookingPayAction(b)).toMatchObject({ label: "Pay to hold your date", amountMinor: 308000000, payOptions: [], fullNowReason: "balance_due_passed" });
  });
  test("a deposit offered: no reason on the pay action; unknown values are dropped", () => {
    const b = purchases.parseVenueBooking(row({ payModes: [{ mode: "deposit", amountMinor: 129000000 }, { mode: "full", amountMinor: 308000000 }], fullNowReason: "balance_due_passed" }));
    expect(purchases.venueBookingPayAction(b).fullNowReason).toBeNull();
    expect(purchases.parseVenueBooking(row({ fullNowReason: "whatever" })).fullNowReason).toBeNull();
    expect(purchases.parseVenueBooking(row({ fullNowReason: undefined })).fullNowReason).toBeNull();
  });
});
