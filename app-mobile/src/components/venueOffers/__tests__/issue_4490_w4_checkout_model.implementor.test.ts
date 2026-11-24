// MINGLA-INVARIANT: I-NATIVE-OFFER-CHECKOUT-NO-CLIENT-PRICE | issue #4490 | the native venue-offer checkout sends only the choice (ids, counts, answers), never an amount; Review rows and the Pay total come from the server quote only.
/**
 * #4490 Explorer W4 — the checkout sheet's pure model and the seam.
 *
 *   Q-*  `quote` bodies per kind carry the choice only (ids, counts, answers):
 *        never an amount (I-NATIVE-OFFER-CHECKOUT-NO-CLIENT-PRICE, rule 1)
 *   F-*  choice fingerprints: same choice → same string; any change → new
 *   R-*  Review rows and "Pay {total}" come from the server's quote only
 *   G-*  guest details: profile values, editable, checked before hold; N139
 *        reserved domains refused in words
 *   S-*  the seam: tab → kind; no "from" price travels
 *
 * FAILS-ON-REVERT: add `totalMinor` to an entry quote body and Q-1 fails;
 * drop the reserved-domain check and G-2 fails; compute the total from lines
 * and R-2 fails.
 */
import {
  bookingRefFrom,
  checkoutTitle,
  choiceFingerprint,
  guestBody,
  guestDetailsProblem,
  guestFingerprint,
  parseVenueReviewQuote,
  payNowMinor,
  planRefFrom,
  quoteBodyFor,
  resumeTitle,
  reviewRows,
} from "../venueCheckoutModel";
import { venueCheckoutKindForTab, venueOfferCheckoutOpen } from "../venueOfferCheckoutSeam";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe(v: unknown): void;
  toEqual(v: unknown): void;
  toBeNull(): void;
  toMatch(v: RegExp): void;
  not: { toBe(v: unknown): void; toMatch(v: RegExp): void; toBeNull(): void };
};

const MONEY_KEY = /minor|price|total|amount|fee|vat|deposit|balance/i;
const keysDeep = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysDeep(x, out);
    }
  }
  return out;
};

const QUOTE_RAW = {
  quoteId: "00000000-4490-4000-8000-0000000004f1",
  currencyCode: "NGN",
  subtotalMinor: 1450000,
  feeMinor: 72500,
  taxMinor: 0,
  totalMinor: 1522500,
  expiresAt: "2026-11-22T12:15:00Z",
  vat: { mode: "none" },
  window: { windowId: "w1", localDate: "2026-11-28", startsAt: "2026-11-28T16:00:00Z", endsAt: "2026-11-28T22:00:00Z" },
  lines: [
    { priceOptionId: "p1", name: "Arcade day pass", guests: 2, unitPriceMinor: 400000, baseMinor: 800000, taxMinor: 0, totalMinor: 800000 },
    { priceOptionId: "p2", name: "VR session", guests: 1, unitPriceMinor: 650000, baseMinor: 650000, taxMinor: 0, totalMinor: 650000 },
  ],
};

describe("Q: quote bodies carry the choice, never an amount (rule 1)", () => {
  it("Q-1 every kind", () => {
    const bodies = [
      quoteBodyFor({ kind: "entry", offeringId: "o", windowId: "w", lines: [{ priceOptionId: "p", guests: 2 }], day: "2026-11-28", time: "17:00" }),
      quoteBodyFor({ kind: "group_package", offeringId: "o", windowId: "w", priceOptionId: "p", guests: 15, extraIds: ["x"], answers: { Cake: "Chocolate" }, day: "2026-11-28", time: "14:00" }),
      quoteBodyFor({ kind: "private_hire", offeringId: "o", windowId: "w", priceOptionId: "p", guests: 120, layout: "seated", extraIds: [], answers: { occasion: "Party" }, day: "2026-12-05" }),
      quoteBodyFor({ kind: "by_the_hour", offeringId: "o", startsAt: "2026-11-20T09:00:00Z", minutes: 120, guests: 1, priceOptionId: "p", day: "2026-11-20", time: "10:00" }),
    ];
    for (const b of bodies) {
      expect(keysDeep(b).filter((k) => MONEY_KEY.test(k) && k !== "priceOptionId")).toEqual([]);
    }
    expect(bodies[0]).toEqual({ offeringId: "o", windowId: "w", lines: [{ priceOptionId: "p", guests: 2 }] });
    expect(bodies[2]).toEqual({
      offeringId: "o",
      windowId: "w",
      lines: [{ priceOptionId: "p", guests: 120, layout: "seated" }],
      extras: [],
      answers: { occasion: "Party" },
    });
    expect(bodies[3]).toEqual({
      offeringId: "o",
      startsAt: "2026-11-20T09:00:00Z",
      minutes: 120,
      lines: [{ guests: 1, priceOptionId: "p" }],
      extras: [],
    });
  });
});

describe("F: fingerprints", () => {
  it("F-1 same choice same string (order-free), any change new", () => {
    const a = choiceFingerprint({ kind: "entry", offeringId: "o", windowId: "w", lines: [{ priceOptionId: "a", guests: 1 }, { priceOptionId: "b", guests: 2 }], day: "d", time: null });
    const b = choiceFingerprint({ kind: "entry", offeringId: "o", windowId: "w", lines: [{ priceOptionId: "b", guests: 2 }, { priceOptionId: "a", guests: 1 }], day: "d", time: null });
    const c = choiceFingerprint({ kind: "entry", offeringId: "o", windowId: "w", lines: [{ priceOptionId: "b", guests: 3 }, { priceOptionId: "a", guests: 1 }], day: "d", time: null });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(choiceFingerprint({ kind: "plan", planId: "p", startOn: null })).not.toBe(choiceFingerprint({ kind: "plan", planId: "p", startOn: "2026-11-30" }));
  });
});

describe("R: Review rows and the pay amount are the server's", () => {
  it("R-1 quote → reducer ref; entry is full only", () => {
    const r = parseVenueReviewQuote(QUOTE_RAW);
    expect(r?.ref).toEqual({ quoteId: QUOTE_RAW.quoteId, currencyCode: "NGN", totalMinor: 1522500, payModes: ["full"], depositMinor: null });
    expect(r?.mode).toBe("instant");
  });
  it("R-2 rows show the server's lines, fee and total; Pay uses the server's total, never a sum", () => {
    const r = parseVenueReviewQuote({ ...QUOTE_RAW, totalMinor: 9999 });
    const rows = r === null ? [] : reviewRows(r, 2);
    expect(rows.map((x) => x.label)).toEqual(["2 × Arcade day pass", "1 × VR session", "Booking fee", "Total"]);
    expect(rows[rows.length - 1].value).toMatch(/99\.99/);
    expect(r === null ? 0 : payNowMinor(r, null)).toBe(9999);
  });
  it("R-3 a package with a deposit: Half now pays the server's deposit", () => {
    const r = parseVenueReviewQuote({ ...QUOTE_RAW, payPlan: { payModes: ["deposit", "full"], depositMinor: 9993800, balanceDueAt: "2026-11-27T00:00:00Z" } });
    expect(r?.ref.payModes).toEqual(["deposit", "full"]);
    expect(r === null ? 0 : payNowMinor(r, "deposit")).toBe(9993800);
    expect(r === null ? 0 : payNowMinor(r, "full")).toBe(1522500);
  });
  it("R-4 a hire quote: request mode, plan under hire", () => {
    const r = parseVenueReviewQuote({ ...QUOTE_RAW, mode: "request", hire: { guests: 120, payPlan: { payModes: ["full"] } } });
    expect(r?.mode).toBe("request");
    const inst = parseVenueReviewQuote({ ...QUOTE_RAW, mode: "instant", hire: { guests: 120 } });
    expect(inst?.mode).toBe("instant");
  });
  it("R-5 not a quote → null", () => {
    expect(parseVenueReviewQuote({})).toBeNull();
    expect(parseVenueReviewQuote(null)).toBeNull();
  });
  it("R-6 booking refs from hold / get; plan refs from join", () => {
    expect(bookingRefFrom({ groupId: "g", version: 3, state: "instant_payment_pending", totalMinor: 5, amountDueNowMinor: 5, holdUntil: "t" })).toEqual({
      id: "g", version: 3, state: "instant_payment_pending", totalMinor: 5, amountDueNowMinor: 5, holdUntil: "t",
    });
    expect(bookingRefFrom({ status: "active" })).toBeNull();
    // TEST-MOD-APPROVED #4490 (06-W4 fix 1, W4-N2): the plan's amount is the server's amount due
    // (paymentDue.amountMinor, VAT included), never the plan's list price.
    expect(planRefFrom({ subscriptionId: "s", status: "pending", raw: { paymentDue: { amountMinor: 5375000 } } }).totalMinor).toBe(5375000);
    expect(planRefFrom({ subscriptionId: "s", status: "requested", raw: {} }).totalMinor).toBe(0);
  });
});

describe("G: guest details", () => {
  it("G-1 the buyer-web words, in order", () => {
    expect(guestDetailsProblem({ name: " ", email: "a@b.co", phone: "" })?.message).toBe("Add your name.");
    expect(guestDetailsProblem({ name: "Ada", email: "nope", phone: "" })?.message).toBe("Add a valid email. Your pass is sent there.");
    expect(guestDetailsProblem({ name: "Ada", email: "ada@example.com", phone: "0803" })?.message).toBe("Check the phone number, or leave it empty.");
    expect(guestDetailsProblem({ name: "Ada", email: "ada@example.com", phone: "" })).toBeNull();
    expect(guestDetailsProblem({ name: "Ada", email: "ada@example.com", phone: "+234 803 123 4567" })).toBeNull();
  });
  it("G-2 N139: reserved test domains are refused in words (any case)", () => {
    for (const email of ["a@x.test", "a@MAIL.EXAMPLE.TEST", "a@b.invalid", "a@host.localhost", "a@b.example", "a@b.local"]) {
      expect(guestDetailsProblem({ name: "Ada", email, phone: "" })?.message).toMatch(/^Use an email address you can get receipts at\./);
    }
  });
  it("G-3 body trimmed, phone only when given; new details are a new hold input", () => {
    expect(guestBody({ name: " Ada ", email: " ada@example.com ", phone: "" })).toEqual({ name: "Ada", email: "ada@example.com" });
    expect(guestBody({ name: "Ada", email: "ada@example.com", phone: "+234 803-123-4567" }).phone).toBe("+2348031234567");
    expect(guestFingerprint({ name: "Ada", email: "ADA@example.com", phone: "" })).toBe(guestFingerprint({ name: "Ada", email: "ada@example.com", phone: "" }));
    expect(guestFingerprint({ name: "Ada", email: "ada@example.com", phone: "" })).not.toBe(guestFingerprint({ name: "Ade", email: "ada@example.com", phone: "" }));
  });
});

describe("S: the seam and titles", () => {
  it("S-1 tab → kind", () => {
    expect(venueCheckoutKindForTab("entry")).toBe("entry");
    expect(venueCheckoutKindForTab("groups")).toBe("group_package");
    expect(venueCheckoutKindForTab("hire")).toBe("private_hire");
    expect(venueCheckoutKindForTab("by_the_hour")).toBe("by_the_hour");
    expect(venueCheckoutKindForTab("plans")).toBe("plan");
    expect(venueCheckoutKindForTab("menu")).toBeNull();
    expect(venueCheckoutKindForTab("reservations")).toBeNull();
  });
  it("S-2 the sheet opens with ids and venue facts only (no price)", () => {
    const open = venueOfferCheckoutOpen(
      { brandSlug: "b", venueSlug: "v", tab: "entry", offerId: "o" },
      { venueId: "id", venueName: "V", currencyCode: "NGN", exponent: 2, timezone: null, lat: null, lng: null, category: null },
    );
    expect(open).not.toBeNull();
    expect(keysDeep(open).filter((k) => MONEY_KEY.test(k))).toEqual([]);
  });
  it("S-3 titles: design words; Purchases resume titles", () => {
    expect(checkoutTitle("entry", "V")).toBe("Buy entry");
    expect(checkoutTitle("plan", "Kora Works")).toBe("Join Kora Works");
    expect(resumeTitle("approved_payment_required")).toBe("Pay to hold your date");
    expect(resumeTitle("confirmed")).toBe("Pay the rest");
  });
});
