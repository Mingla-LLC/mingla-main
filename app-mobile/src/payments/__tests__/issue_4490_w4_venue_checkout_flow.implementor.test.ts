/**
 * #4490 Explorer W4 — the venue offer checkout reducer (spec 06 W4 rules 1,
 * 2, 5, 6, 7). Every transition, retry, key rule and copy mapping.
 *
 *   T-*  transitions per kind (entry, group, hire, by the hour, plan)
 *   K-*  idempotency: one key per step, reused on retry, new on changed input
 *   P-*  payment outcomes: confirmed, failed / not paid → Review, pending, expired
 *   C-*  codes → §6 words; unmapped → generic; never a raw code
 *   G-*  guards: no transition from the wrong phase, busy blocks dismiss
 *
 * FAILS-ON-REVERT: make `keyForStep` always return the fresh key and K-2 / K-3
 * fail; drop `payAttempt` from the pay inputs and K-5 fails; map unknown codes
 * through and C-3 fails; send a free hold to `paying` and T-3 fails.
 */
import {
  capLine,
  effectivePayMode,
  initialVenueCheckoutState,
  isVenueCheckoutBusy,
  keyForStep,
  requestSentLine,
  VENUE_CHECKOUT_COPY,
  venueCheckoutCartKey,
  venueCheckoutNoticeFor,
  venueCheckoutProgress,
  venueCheckoutUuid,
  venueOfferCheckoutReducer as reduce,
  type VenueCheckoutAction,
  type VenueCheckoutBookingRef,
  type VenueCheckoutQuoteRef,
  type VenueCheckoutState,
} from "../venueOfferCheckoutFlow";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe(v: unknown): void;
  toEqual(v: unknown): void;
  toMatch(v: RegExp): void;
  not: { toBe(v: unknown): void; toMatch(v: RegExp): void; toContain(v: string): void };
  toBeNull(): void;
  toContain(v: string): void;
};

const CART = "a".repeat(32);
const QUOTE: VenueCheckoutQuoteRef = {
  quoteId: "00000000-4490-4000-8000-00000000q001",
  currencyCode: "NGN",
  totalMinor: 1522500,
  payModes: ["full"],
  depositMinor: null,
};
const PKG_QUOTE: VenueCheckoutQuoteRef = {
  quoteId: "00000000-4490-4000-8000-00000000q002",
  currencyCode: "NGN",
  totalMinor: 19987500,
  payModes: ["deposit", "full"],
  depositMinor: 9993800,
};
const BOOKING: VenueCheckoutBookingRef = {
  id: "00000000-4490-4000-8000-00000000b001",
  version: 1,
  state: "instant_payment_pending",
  totalMinor: 1522500,
  amountDueNowMinor: 1522500,
  holdUntil: "2026-11-22T12:15:00Z",
};

const run = (state: VenueCheckoutState, ...actions: VenueCheckoutAction[]): VenueCheckoutState =>
  actions.reduce(reduce, state);

const toReview = (kind: VenueCheckoutState["kind"] = "entry", quote = QUOTE): VenueCheckoutState =>
  run(
    initialVenueCheckoutState(kind, CART),
    { type: "choose", choice: "date=2026-11-28|opt1=2" },
    { type: "quote_start", freshKey: "kq1" },
    { type: "quote_ok", quote },
  );

const toAwaiting = (): VenueCheckoutState =>
  run(
    toReview(),
    { type: "hold_start", freshKey: "kh1", guest: "ada|ada@example.com|" },
    { type: "hold_ok", booking: BOOKING, mode: "instant" },
    { type: "pay_start", freshKey: "kp1" },
    { type: "pay_ok", provider: "paystack" },
  );

describe("T: transitions", () => {
  it("T-1 entry: choose → quoting → review → holding → paying → awaiting → confirming → booked", () => {
    let s = initialVenueCheckoutState("entry", CART);
    expect(s.phase).toBe("choosing");
    s = reduce(s, { type: "choose", choice: "c1" });
    s = reduce(s, { type: "quote_start", freshKey: "kq" });
    expect(s.phase).toBe("quoting");
    s = reduce(s, { type: "quote_ok", quote: QUOTE });
    expect(s.phase).toBe("review");
    s = reduce(s, { type: "hold_start", freshKey: "kh", guest: "g" });
    expect(s.phase).toBe("holding");
    s = reduce(s, { type: "hold_ok", booking: BOOKING, mode: "instant" });
    expect(s.phase).toBe("paying");
    s = reduce(s, { type: "pay_start", freshKey: "kp" });
    expect(s.phase).toBe("paying");
    s = reduce(s, { type: "pay_ok", provider: "paystack" });
    expect(s.phase).toBe("awaiting_payment");
    expect(s.provider).toBe("paystack");
    s = reduce(s, { type: "payment_closed" });
    expect(s.phase).toBe("confirming");
    s = reduce(s, { type: "confirm_done", outcome: "confirmed" });
    expect(s.phase).toBe("booked");
  });

  it("T-2 private hire: a request hold ends at requested with no payment", () => {
    const s = run(
      toReview("private_hire"),
      { type: "hold_start", freshKey: "kh", guest: "g" },
      { type: "hold_ok", booking: { ...BOOKING, state: "request_pending" }, mode: "request" },
    );
    expect(s.phase).toBe("requested");
    expect(s.keys.pay).toBe(undefined);
    expect(requestSentLine("Gameland Lagos")).toBe(
      "Request sent. Gameland Lagos will reply soon. Nothing to pay until they do.",
    );
  });

  it("T-3 rule 7: a free hold (total 0) confirms at hold, no payment page", () => {
    const free = run(
      toReview("entry", { ...QUOTE, totalMinor: 0 }),
      { type: "hold_start", freshKey: "kh", guest: "g" },
      { type: "hold_ok", booking: { ...BOOKING, totalMinor: 0, amountDueNowMinor: 0, state: "confirmed" }, mode: "instant" },
    );
    expect(free.phase).toBe("booked");
    expect(free.keys.pay).toBe(undefined);
    const zeroButPending = run(
      toReview("entry", { ...QUOTE, totalMinor: 0 }),
      { type: "hold_start", freshKey: "kh", guest: "g" },
      { type: "hold_ok", booking: { ...BOOKING, totalMinor: 0, amountDueNowMinor: 0 }, mode: "instant" },
    );
    expect(zeroButPending.phase).toBe("booked");
  });

  // TEST-MOD-APPROVED #4490 (06-W4 fix 1, W4-N2): an instant join now lands on Review (the server's
  // amount due, VAT included, shown before the payment page opens); Pay starts the payment from there.
  it("T-4 plan: choose → joining → review (instant), requested (by request), booked (active)", () => {
    const chosen = reduce(initialVenueCheckoutState("plan", CART), { type: "choose", choice: "plan=p1|start=2026-11-23" });
    const joining = reduce(chosen, { type: "join_start", freshKey: "kj", guest: "g" });
    expect(joining.phase).toBe("joining");
    const sub = { ...BOOKING, id: "00000000-4490-4000-8000-00000000s001", state: "pending_payment" };
    const joined = reduce(joining, { type: "join_ok", booking: sub, mode: "instant" });
    expect(joined.phase).toBe("review");
    expect(reduce(joined, { type: "pay_start", freshKey: "kp" }).phase).toBe("paying");
    expect(reduce(joining, { type: "join_ok", booking: { ...sub, state: "requested" }, mode: "request" }).phase).toBe("requested");
    expect(reduce(joining, { type: "join_ok", booking: { ...sub, state: "active" }, mode: "instant" }).phase).toBe("booked");
  });

  it("T-5 join is a plan step only", () => {
    const entry = reduce(initialVenueCheckoutState("entry", CART), { type: "choose", choice: "c" });
    expect(reduce(entry, { type: "join_start", freshKey: "k", guest: "g" })).toBe(entry);
  });

  it("T-6 from Purchases (Pay to hold your date / Pay the rest): opens at review with the booking, no quote", () => {
    const s = initialVenueCheckoutState("private_hire", CART, {
      booking: { ...BOOKING, state: "approved_payment_required" },
      payMode: "deposit",
    });
    expect(s.phase).toBe("review");
    expect(s.openedAt).toBe("pay");
    expect(s.quote).toBeNull();
    const paying = reduce(s, { type: "pay_start", freshKey: "kp" });
    expect(paying.phase).toBe("paying");
    expect(paying.payMode).toBe("deposit");
    // There is no step 1 to go back to from Purchases.
    expect(reduce(s, { type: "back_to_choose" })).toBe(s);
  });

  it("T-7 group package: Half now / All now only among the server's modes", () => {
    const s = toReview("group_package", PKG_QUOTE);
    expect(effectivePayMode(s)).toBe("deposit");
    const all = reduce(s, { type: "set_pay_mode", payMode: "full" });
    expect(all.payMode).toBe("full");
    const fullOnly = toReview("group_package", QUOTE);
    expect(reduce(fullOnly, { type: "set_pay_mode", payMode: "deposit" })).toBe(fullOnly);
    expect(effectivePayMode(fullOnly)).toBeNull();
  });

  it("T-8 back to choose from review keeps the choice; progress dashes follow the phase", () => {
    const s = toReview();
    expect(venueCheckoutProgress(s)).toBe(2);
    const back = reduce(s, { type: "back_to_choose" });
    expect(back.phase).toBe("choosing");
    expect(back.choice).toBe(s.choice);
    expect(venueCheckoutProgress(back)).toBe(1);
    expect(venueCheckoutProgress(toAwaiting())).toBe(3);
  });
});

describe("K: idempotency keys (rule 2)", () => {
  it("K-1 cart key: one per session, the server's [A-Za-z0-9_-]{32,64}; uuids are v4", () => {
    const uuid = venueCheckoutUuid();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuid).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/);
    expect(venueCheckoutCartKey(uuid)).toMatch(/^[A-Za-z0-9_-]{32,64}$/);
    const s = toAwaiting();
    expect(s.cartKey).toBe(CART);
  });

  it("K-2 a retry of the same step with the same inputs reuses the key", () => {
    const failed = run(toReview(), { type: "hold_start", freshKey: "kh1", guest: "g" }, {
      type: "step_failed",
      step: "hold",
      code: "venue_unreachable",
      venueName: "V",
    });
    expect(failed.phase).toBe("error");
    const retried = reduce(failed, { type: "retry", freshKey: "kh2" });
    expect(retried.phase).toBe("holding");
    expect(retried.keys.hold?.key).toBe("kh1");
    // A second hold_start with the same guest (the Pay button again) also reuses it.
    const again = run(failed, { type: "hold_start", freshKey: "kh3", guest: "g" });
    expect(again.keys.hold?.key).toBe("kh1");
  });

  it("K-3 changed inputs get a new key: a new choice drops every key; new guest details make a new hold key", () => {
    const held = run(toReview(), { type: "hold_start", freshKey: "kh1", guest: "g1" }, {
      type: "step_failed",
      step: "hold",
      code: "x",
      venueName: "V",
    });
    const newGuest = reduce(reduce(held, { type: "back_to_review" }), { type: "hold_start", freshKey: "kh2", guest: "g2" });
    expect(newGuest.keys.hold?.key).toBe("kh2");
    const rechosen = reduce(toReview(), { type: "choose", choice: "date=2026-11-29|opt1=2" });
    expect(rechosen.keys).toEqual({});
    expect(rechosen.quote).toBeNull();
    const requote = reduce(rechosen, { type: "quote_start", freshKey: "kq9" });
    expect(requote.keys.quote?.key).toBe("kq9");
  });

  it("K-4 the same choice again is no change (keys kept)", () => {
    const s = toReview();
    expect(reduce(s, { type: "choose", choice: s.choice as string })).toBe(s);
    const requote = run(reduce(s, { type: "back_to_choose" }), { type: "quote_start", freshKey: "kq-new" });
    expect(requote.keys.quote?.key).toBe("kq1");
  });

  it("K-5 Try again after a payment that did not go through is a NEW pay key (new attempt)", () => {
    const failed = run(toAwaiting(), { type: "payment_closed" }, { type: "confirm_done", outcome: "failed" });
    expect(failed.phase).toBe("review");
    expect(failed.payAttempt).toBe(1);
    const again = reduce(failed, { type: "pay_start", freshKey: "kp2" });
    expect(again.keys.pay?.key).toBe("kp2");
    expect(again.keys.pay?.key).not.toBe("kp1");
    // While a pay step merely errored (no verdict), the retry keeps the key.
    const errored = run(
      toReview(),
      { type: "hold_start", freshKey: "kh", guest: "g" },
      { type: "hold_ok", booking: BOOKING, mode: "instant" },
      { type: "pay_start", freshKey: "kpA" },
      { type: "step_failed", step: "pay", code: "venue_unreachable", venueName: "V" },
      { type: "retry", freshKey: "kpB" },
    );
    expect(errored.keys.pay?.key).toBe("kpA");
  });

  it("K-6 a replayed hold returning the original booking keeps that booking (the server's own id)", () => {
    const first = run(toReview(), { type: "hold_start", freshKey: "kh1", guest: "g" }, { type: "step_failed", step: "hold", code: "venue_unreachable", venueName: "V" });
    const replay = run(first, { type: "retry", freshKey: "khX" }, { type: "hold_ok", booking: BOOKING, mode: "instant" });
    expect(replay.keys.hold?.key).toBe("kh1");
    expect(replay.booking?.id).toBe(BOOKING.id);
  });

  it("K-7 keyForStep is pure: same inputs → held, else the fresh candidate", () => {
    const keys = { pay: { key: "a", inputs: "x" } };
    expect(keyForStep(keys, "pay", "x", "b")).toEqual({ key: "a", inputs: "x" });
    expect(keyForStep(keys, "pay", "y", "b")).toEqual({ key: "b", inputs: "y" });
    expect(keyForStep({}, "quote", "z", "c")).toEqual({ key: "c", inputs: "z" });
  });

  it("K-8 a pay mode change is a new pay input (new key)", () => {
    const review = toReview("group_package", PKG_QUOTE);
    const held = run(review, { type: "hold_start", freshKey: "kh", guest: "g" }, { type: "hold_ok", booking: BOOKING, mode: "instant" });
    const p1 = reduce(held, { type: "pay_start", freshKey: "kp1" });
    expect(p1.payMode).toBe("deposit");
    const back = run(p1, { type: "step_failed", step: "pay", code: "x", venueName: "V" }, { type: "back_to_review" }, { type: "set_pay_mode", payMode: "full" });
    const p2 = reduce(back, { type: "pay_start", freshKey: "kp2" });
    expect(p2.keys.pay?.key).toBe("kp2");
  });
});

describe("P: payment outcomes (rule 5)", () => {
  it("P-1 failed and not_paid → Review with the §6 line", () => {
    for (const outcome of ["failed", "not_paid"] as const) {
      const s = run(toAwaiting(), { type: "payment_closed" }, { type: "confirm_done", outcome });
      expect(s.phase).toBe("review");
      expect(s.notice?.message).toBe("Payment didn't go through. You haven't been charged.");
    }
  });

  it("P-2 pending after the polls → the pending state", () => {
    const s = run(toAwaiting(), { type: "payment_closed" }, { type: "confirm_done", outcome: "pending" });
    expect(s.phase).toBe("pending");
    expect(VENUE_CHECKOUT_COPY.pending).toBe("We're checking your payment. This can take a minute.");
  });

  it("P-3 hold expired → back to step 1 with the §6 line, keys and quote spent", () => {
    const s = run(toAwaiting(), { type: "payment_closed" }, { type: "confirm_done", outcome: "expired" });
    expect(s.phase).toBe("choosing");
    expect(s.notice?.message).toBe("Your hold ran out. Pick a time again.");
    expect(s.keys).toEqual({});
    expect(s.quote).toBeNull();
    expect(s.booking).toBeNull();
    const fromHold = run(toReview(), { type: "hold_start", freshKey: "k", guest: "g" }, { type: "step_failed", step: "hold", code: "offer_hold_expired", venueName: "V" });
    expect(fromHold.phase).toBe("choosing");
  });

  it("P-4 offer_payment_already_paid is confirmed (the runner re-reads and sends confirmed)", () => {
    const s = run(
      toReview(),
      { type: "hold_start", freshKey: "kh", guest: "g" },
      { type: "hold_ok", booking: BOOKING, mode: "instant" },
      { type: "pay_start", freshKey: "kp" },
      { type: "confirm_done", outcome: "confirmed", booking: { ...BOOKING, state: "confirmed" } },
    );
    expect(s.phase).toBe("booked");
    expect(s.booking?.state).toBe("confirmed");
  });

  it("P-5 the quote numbers are the server's own (stored as given, never derived)", () => {
    const s = toReview("group_package", PKG_QUOTE);
    expect(s.quote).toEqual(PKG_QUOTE);
    const held = run(s, { type: "hold_start", freshKey: "kh", guest: "g" }, { type: "hold_ok", booking: { ...BOOKING, totalMinor: 19987500, amountDueNowMinor: 9993800 }, mode: "instant" });
    expect(held.booking?.amountDueNowMinor).toBe(9993800);
  });

  it("P-6 a new quote replacing an old one drops the stale hold and pay keys", () => {
    const s = run(
      toReview(),
      { type: "hold_start", freshKey: "kh", guest: "g" },
      { type: "step_failed", step: "hold", code: "offer_quote_expired", venueName: "V", selectionMessage: "Prices are held for 15 minutes. We've checked them again." },
      { type: "back_to_review" },
      { type: "back_to_choose" },
      { type: "quote_start", freshKey: "kq2" },
      { type: "quote_ok", quote: { ...QUOTE, quoteId: "00000000-4490-4000-8000-00000000q009" } },
    );
    expect(s.keys.hold).toBe(undefined);
  });
});

describe("C: codes → words (rule 6, §6 exact)", () => {
  it("C-1 offers_not_enabled (VENUE_OFFERS_WRITES off) → paused", () => {
    expect(venueCheckoutNoticeFor("offers_not_enabled", "V")).toEqual({
      code: "paused",
      message: "Bookings are paused here right now. Try again later.",
    });
  });
  it("C-2 single-payment cap → the cap line with the venue's name", () => {
    expect(venueCheckoutNoticeFor("offer_amount_too_large", "Gameland Lagos").message).toBe(
      "This is more than we can take in one payment. Book fewer places or contact Gameland Lagos.",
    );
    expect(capLine("X")).toBe("This is more than we can take in one payment. Book fewer places or contact X.");
  });
  it("C-3 unmapped codes → the generic line, never the code", () => {
    for (const code of ["venue_request_failed", "rate_limited", "auth_invalid", "PT409", "offer_payment_unavailable", "weird_new_code"]) {
      const n = venueCheckoutNoticeFor(code, "V");
      expect(n.message).toBe("Something went wrong. Try again.");
      expect(n.message).not.toContain(code);
    }
  });
  it("C-4 offline → the §5 offline line; hold expired → §6", () => {
    expect(venueCheckoutNoticeFor("offline", "V").message).toBe("You're offline. Check your connection and try again.");
    expect(venueCheckoutNoticeFor("offer_hold_expired", "V").message).toBe("Your hold ran out. Pick a time again.");
  });
  it("C-5 guest-fixable codes use the shared buyer-web words passed in; without them, generic", () => {
    expect(venueCheckoutNoticeFor("offer_sold_out", "V", () => "That day sold out online. Choose another day.").message).toBe(
      "That day sold out online. Choose another day.",
    );
    expect(venueCheckoutNoticeFor("offer_sold_out", "V").message).toBe("Something went wrong. Try again.");
    const s = run(toReview(), { type: "hold_start", freshKey: "k", guest: "g" }, {
      type: "step_failed",
      step: "hold",
      code: "offer_guest_invalid",
      venueName: "V",
      selectionMessage: "Check your name, email and phone.",
    });
    expect(s.notice).toEqual({ code: "guest", message: "Check your name, email and phone." });
    const raw = run(toReview(), { type: "hold_start", freshKey: "k", guest: "g" }, {
      type: "step_failed",
      step: "hold",
      code: "some_internal_code",
      venueName: "V",
      selectionMessage: "SHOULD NOT SHOW",
    });
    expect(raw.notice?.message).toBe("Something went wrong. Try again.");
  });
});

describe("G: guards", () => {
  it("G-1 out-of-phase actions are ignored", () => {
    const start = initialVenueCheckoutState("entry", CART);
    expect(reduce(start, { type: "quote_start", freshKey: "k" })).toBe(start); // nothing chosen
    expect(reduce(start, { type: "quote_ok", quote: QUOTE })).toBe(start);
    expect(reduce(start, { type: "hold_start", freshKey: "k", guest: "g" })).toBe(start);
    expect(reduce(start, { type: "pay_start", freshKey: "k" })).toBe(start);
    expect(reduce(start, { type: "pay_ok", provider: "stripe" })).toBe(start);
    expect(reduce(start, { type: "payment_closed" })).toBe(start);
    expect(reduce(start, { type: "confirm_done", outcome: "confirmed" })).toBe(start);
    expect(reduce(start, { type: "retry", freshKey: "k" })).toBe(start);
    const r = toReview();
    expect(reduce(r, { type: "step_failed", step: "pay", code: "x", venueName: "V" })).toBe(r);
  });
  it("G-2 busy phases block dismissal and a second quote; choose is ignored mid-payment", () => {
    const s = toAwaiting();
    expect(isVenueCheckoutBusy(s)).toBe(true);
    expect(reduce(s, { type: "choose", choice: "other" })).toBe(s);
    expect(reduce(s, { type: "back_to_choose" })).toBe(s);
    expect(isVenueCheckoutBusy(toReview())).toBe(false);
  });
  it("G-3 the copy is §6 word for word", () => {
    expect(VENUE_CHECKOUT_COPY.review).toBe("Review");
    expect(VENUE_CHECKOUT_COPY.sendRequest).toBe("Send request");
    expect(VENUE_CHECKOUT_COPY.halfNow).toBe("Half now");
    expect(VENUE_CHECKOUT_COPY.allNow).toBe("All now");
    expect(VENUE_CHECKOUT_COPY.booked).toBe("You're booked");
    expect(VENUE_CHECKOUT_COPY.seeInPurchases).toBe("See in Purchases");
    expect(VENUE_CHECKOUT_COPY.generic).toBe("Something went wrong. Try again.");
  });
});
