/* eslint-disable @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * #4490 spec 06 W4 fix 1 — the pure parts.
 *
 *   P-1 entryOptionRows prices an option for the chosen SESSION (its own row),
 *       marks it day-priced, and never marks a list price as the day's price
 *   P-2 the plan read's charge and a member read's amount due parse the server's
 *       numbers only (fail closed); the plan Review rows are the shared summary
 *   P-3 a plan join lands on Review (W4-N2); offer_payment_mode_conflict reads
 *       the existing "Something changed…" line (W4-N3)
 *   P-4 resuming after signing in again (W4-N4): an in-flight step goes back
 *       to where it can be pressed again; the re-read booking decides the step
 *   P-5 where a kept checkout goes back to
 *
 * FAILS-ON-REVERT: drop the windowId preference in entryOptionRows and P-1
 * fails; send join_ok to paying and P-3 fails; drop `resumed` and P-4 fails.
 */
const { entryOptionRows } = require("@mingla/brand-rendering/venueOffers/entryModel");
const { parsePlan, parsePlanCharge } = require("@mingla/brand-rendering/venueFeaturePage");
const flow = require("../../../payments/venueOfferCheckoutFlow");
const model = require("../venueCheckoutModel");
const resume = require("../venueCheckoutResume");

const OPT = { id: "o1", name: "Adult", priceMinor: 300000, guestMin: 1, guestMax: 6, weekdays: null, startTime: null, endTime: null, idCheckLabel: null };
const row = (windowId: string, price: number | null, status = "available") => ({
  localDate: "2026-11-27", startsAt: "", endsAt: "", windowId, status, reason: null, remaining: 10, priceMinor: price,
});

describe("P-1 option rows for the chosen session", () => {
  it("prices the chosen session's own row (a dearer 16:00), not the day's first session", () => {
    const per = new Map([["o1", [row("w10", 300000), row("w16", 450000)]]]);
    expect(entryOptionRows([OPT], "2026-11-27", per, "w16")[0]).toMatchObject({ priceMinor: 450000, dayPriced: true, usable: true });
    expect(entryOptionRows([OPT], "2026-11-27", per, null)[0]).toMatchObject({ priceMinor: 300000, dayPriced: true });
  });
  it("no row for the option yet: the list price is carried but never marked as the day's price", () => {
    expect(entryOptionRows([OPT], "2026-11-27", new Map(), "w16")[0]).toMatchObject({ priceMinor: 300000, dayPriced: false });
    expect(entryOptionRows([OPT], null, new Map([["o1", [row("w16", 450000)]]]), null)[0].dayPriced).toBe(false);
  });
  it("a row with no price is not a day price either", () => {
    expect(entryOptionRows([OPT], "2026-11-27", new Map([["o1", [row("w16", null)]]]), "w16")[0].dayPriced).toBe(false);
  });
});

describe("P-2 plan charges are the server's", () => {
  const CHARGE = { unit: "minor", baseMinor: 5000000, feeMinor: 0, taxMinor: 375000, totalMinor: 5375000, vatMode: "added", vatRatePct: 7.5 };
  it("the plan read carries the server's charge; none sent → null (no total shown)", () => {
    const base = { id: "p", name: "Flex", priceMinor: 5000000, interval: "month" };
    expect(parsePlan({ ...base, charge: CHARGE })?.charge).toEqual({ baseMinor: 5000000, feeMinor: 0, taxMinor: 375000, totalMinor: 5375000, vatMode: "added", vatRatePct: 7.5 });
    expect(parsePlan(base)?.charge).toBeNull();
    expect(parsePlanCharge({ baseMinor: "5000000", totalMinor: 1 })).toBeNull();
    expect(parsePlanCharge({ baseMinor: 1, totalMinor: -1 })).toBeNull();
  });
  it("a join answer's amount due → the plan's booking ref and Review rows (no list price anywhere)", () => {
    const raw = { paymentDue: { ...CHARGE, amountMinor: 5375000, periodId: "per" } };
    const ref = model.planRefFrom({ subscriptionId: "s", status: "pending", raw });
    expect(ref).toMatchObject({ id: "s", state: "pending", totalMinor: 5375000, amountDueNowMinor: 5375000 });
    const due = model.planDueFrom(raw);
    const rows = model.planReviewRows(due, "Flex", "NGN", 2);
    expect(rows.map((r) => r.label)).toEqual(["1 × Flex", "VAT 7.5%", "Total"]);
    expect(rows[rows.length - 1].value).toMatch(/53,750/);
    expect(model.planDueFrom({ paymentDue: null })).toBeNull();
  });
});

describe("P-3 plan Review and the mode conflict line", () => {
  const CART = "c".repeat(32);
  it("an instant join lands on Review; Pay starts the payment from there", () => {
    let s = flow.initialVenueCheckoutState("plan", CART);
    s = flow.venueOfferCheckoutReducer(s, { type: "choose", choice: "plan|p|today" });
    s = flow.venueOfferCheckoutReducer(s, { type: "join_start", freshKey: "kj", guest: "g" });
    const booking = { id: "s", version: 1, state: "pending", totalMinor: 5375000, amountDueNowMinor: 5375000, holdUntil: null };
    s = flow.venueOfferCheckoutReducer(s, { type: "join_ok", booking, mode: "instant" });
    expect(s.phase).toBe("review");
    expect(flow.venueCheckoutProgress(s)).toBe(2);
    expect(flow.venueOfferCheckoutReducer(s, { type: "pay_start", freshKey: "kp" }).phase).toBe("paying");
    const zero = { ...booking, totalMinor: 0, amountDueNowMinor: 0, state: "requested" };
    expect(flow.venueOfferCheckoutReducer(flow.venueOfferCheckoutReducer(flow.venueOfferCheckoutReducer(
      flow.initialVenueCheckoutState("plan", CART), { type: "choose", choice: "x" }), { type: "join_start", freshKey: "k", guest: "g" }),
      { type: "join_ok", booking: zero, mode: "request" }).phase).toBe("requested");
  });
  it("offer_payment_mode_conflict reads the existing line, never a code", () => {
    expect(flow.venueCheckoutNoticeFor("offer_payment_mode_conflict", "Gameland")).toEqual({
      code: "generic",
      message: "Something changed while we were saving. Try again.",
    });
  });
});

describe("P-4 resuming after signing in again", () => {
  const CART = "c".repeat(32);
  const HELD = { id: "g", version: 2, state: "instant_payment_pending", totalMinor: 645000, amountDueNowMinor: 645000, holdUntil: "2099-01-01T00:00:00Z" };
  const base = (over = {}) => ({ ...flow.initialVenueCheckoutState("entry", CART), choice: "c", ...over });
  it("an in-flight step goes back to where it can be pressed again (keys kept)", () => {
    const keys = { quote: { key: "kq", inputs: "c" } };
    expect(flow.resumedVenueCheckoutState(base({ phase: "quoting", keys })).phase).toBe("choosing");
    expect(flow.resumedVenueCheckoutState(base({ phase: "quoting", keys })).keys).toBe(keys);
    expect(flow.resumedVenueCheckoutState(base({ phase: "holding", quote: { quoteId: "q" } })).phase).toBe("review");
    expect(flow.resumedVenueCheckoutState(base({ phase: "awaiting_payment", booking: HELD })).phase).toBe("review");
    expect(flow.resumedVenueCheckoutState(base({ phase: "error", failedStep: "pay", booking: HELD })).phase).toBe("review");
    expect(flow.resumedVenueCheckoutState(base({ phase: "booked", booking: HELD })).phase).toBe("booked");
  });
  it("the re-read booking decides: still payable → Review; paid → booked; gone or run out → the §6 line on step 1", () => {
    const s = base({ phase: "review", booking: HELD });
    const now = Date.parse("2026-11-22T12:00:00Z");
    expect(flow.venueOfferCheckoutReducer(s, { type: "resumed", booking: HELD, now }).phase).toBe("review");
    expect(flow.venueOfferCheckoutReducer(s, { type: "resumed", booking: { ...HELD, state: "confirmed" }, now }).phase).toBe("booked");
    const gone = flow.venueOfferCheckoutReducer(s, { type: "resumed", booking: null, now });
    expect(gone.phase).toBe("choosing");
    expect(gone.notice?.message).toBe("Your hold ran out. Pick a time again.");
    const ranOut = flow.venueOfferCheckoutReducer(s, { type: "resumed", booking: { ...HELD, holdUntil: "2026-11-22T11:59:00Z" }, now });
    expect(ranOut.phase).toBe("choosing");
    expect(ranOut.booking).toBeNull();
  });
  it("from Purchases: still owed → Pay again; run out → the line, never an empty step 1", () => {
    const s = { ...flow.initialVenueCheckoutState("private_hire", CART, { booking: { ...HELD, state: "approved_payment_required" }, payMode: "deposit" }) };
    const now = Date.parse("2026-11-22T12:00:00Z");
    expect(flow.venueOfferCheckoutReducer(s, { type: "resumed", booking: { ...HELD, state: "approved_payment_required" }, now }).phase).toBe("review");
    const lost = flow.venueOfferCheckoutReducer(s, { type: "resumed", booking: null, now });
    expect(lost.phase).toBe("error");
    expect(lost.notice?.message).toBe("Your hold ran out. Pick a time again.");
  });
});

describe("P-5 where a kept checkout goes back to", () => {
  it("the venue tab for the kind, or the Purchases booking", () => {
    const venue = { from: "venue", kind: "group_package", brandSlug: "harmattan-qa-local", venueSlug: "gamelandqa" };
    expect(resume.venueCheckoutRouteFor(venue)).toBe("/b/harmattan-qa-local/v/gamelandqa?tab=groups");
    expect(resume.venueCheckoutHomeKey(venue)).toBe("venue:harmattan-qa-local:gamelandqa:group_package");
    const pay = { from: "purchases", kind: "private_hire", booking: { id: "00000000-4490-4000-8000-000000000001" } };
    expect(resume.venueCheckoutRouteFor(pay)).toBe("/purchases/venue_booking/00000000-4490-4000-8000-000000000001");
    expect(resume.venueCheckoutHomeKey(pay)).toBe("pay:00000000-4490-4000-8000-000000000001");
  });
  it("held for one account: the same account gets the route; another drops it", () => {
    resume.holdVenueCheckout({ accountId: "a", route: "/x", homeKey: "k" });
    expect(resume.venueCheckoutRouteAfterSignIn("a")).toBe("/x");
    expect(resume.takeVenueCheckout("b", "k")).toBeNull();
    expect(resume.takeVenueCheckout("a", "other")).toBeNull();
    expect(resume.takeVenueCheckout("a", "k")?.route).toBe("/x");
    expect(resume.takeVenueCheckout("a", "k")).toBeNull();
    resume.holdVenueCheckout({ accountId: "a", route: "/x", homeKey: "k" });
    expect(resume.venueCheckoutRouteAfterSignIn("b")).toBeNull();
    expect(resume.heldVenueCheckoutForTests()).toBeNull();
  });
});
