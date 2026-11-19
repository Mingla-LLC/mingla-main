/**
 * #4490 P2-6 — buying entry as a signed-out guest: the pure model (day tiles
 * and their states, weekday/time rules shown not hidden, steppers inside each
 * price's guest range, the ID note only with a count, VAT added vs included,
 * the hold countdown, the booking page state, refund words, plain error copy),
 * the checkout address (day and counts only, never a token) and the device
 * token store (fragment adopted and scrubbed, kept per booking).
 */
import {
  countdownText,
  entryDayNotice,
  entryDayTiles,
  entryOptionRows,
  entrySelectionProblem,
  holdUntilText,
  idCheckNote,
  impliedVatRatePct,
  nextOpenDate,
  optionUnavailableLine,
  parseEntryBooking,
  parseEntryOfferDetail,
  quoteLinesFor,
  refundPreviewWords,
  stepCount,
  summaryLines,
  vatModeLine,
  venueOfferErrorCopy,
  visitViewFor,
  weekdayRuleText,
  type EntryDayRow,
} from "@mingla/brand-rendering/venueOffers/entryModel";
import { BUILT_VENUE_TABS } from "@mingla/brand-rendering/venueFeaturePage";

import {
  entryCheckoutPath,
  parseEntryCheckoutParams,
} from "../offers/entryCheckoutPath";
import {
  isPublicBuyerRoute,
  isAdPixelRoute,
} from "../../../utils/coldLoadAuthGates";

const OFFER = "282d2932-4e18-4395-a031-b25147fb7139";
const WALKIN = "635c986f-01f9-4837-a51a-9a8e3a4e2de3";
const STUDENT = "14558332-f716-4733-ae26-fb496da6213a";
const GROUP = "41e6ca72-acab-4f77-907c-2770b3aac427";

const offer = parseEntryOfferDetail({
  id: OFFER,
  name: "Entry",
  entryStyle: "walk_in",
  currencyCode: "NGN",
  minorUnitExponent: 2,
  vat: { mode: "added", ratePct: 7.5 },
  options: [
    { id: WALKIN, name: "Walk-in", guestMin: 1, guestMax: 20, weekdays: [0, 1, 2, 3, 4, 5, 6], priceMinor: 500000 },
    {
      id: STUDENT,
      name: "Student & NYSC",
      guestMin: 1,
      guestMax: 20,
      weekdays: [0, 1, 2, 3],
      eligibility: { label: "Student or NYSC ID" },
      priceMinor: 400000,
    },
  ],
  policy: { text: "Full refund up to 1 day(s) before.", refundLadder: [{ minMinutesBefore: 1440, refundBps: 10000 }] },
  venue: { name: "Gameland QA", timezone: "Africa/Lagos" },
});

const row = (date: string, status: EntryDayRow["status"], remaining = 300, reason: string | null = null): EntryDayRow => ({
  localDate: date,
  startsAt: `${date}T11:00:00+00:00`,
  endsAt: `${date}T23:00:00+00:00`,
  windowId: `00000000-0000-4000-8000-${date.replace(/-/g, "").padStart(12, "0")}`,
  status,
  reason,
  remaining,
  priceMinor: 400000,
});

describe("#4490 P2-6 entry model", () => {
  test("E-1 the offer parses fail-closed; Entry is a built tab now", () => {
    expect(offer?.options.map((o) => o.name)).toEqual(["Walk-in", "Student & NYSC"]);
    expect(offer?.options[1].idCheckLabel).toBe("Student or NYSC ID");
    expect(parseEntryOfferDetail({ id: OFFER })).toBeNull();
    expect(BUILT_VENUE_TABS.has("entry")).toBe(true);
  });

  test("E-2 every day state is drawn and explained; a day without a window is Closed", () => {
    const rows = [
      row("2026-11-19", "available", 300),
      row("2026-11-20", "available", 4),
      row("2026-11-21", "sold_out", 0),
      row("2026-11-22", "gate_only", 0),
      row("2026-11-23", "too_soon", 0),
      row("2026-11-24", "too_far", 0),
      row("2026-11-26", "closed", 0, "bookings_paused"),
    ];
    const tiles = entryDayTiles(rows, "2026-11-19", 8);
    expect(tiles.map((t) => t.state)).toEqual([
      "open", "few_left", "full", "gate_only", "too_soon", "not_yet", "closed", "closed",
    ]);
    expect(tiles.map((t) => t.bottom)).toEqual(["", "Few left", "Full", "At the gate", "Too late", "Not yet", "Closed", "Closed"]);
    expect(entryDayNotice(tiles[2])).toBe("Sat 21 Nov is full.");
    expect(entryDayNotice(tiles[3])).toBe("Tickets for Sun 22 Nov are at the gate only.");
    expect(entryDayNotice(tiles[6])).toBe("Closed on Wed 25 Nov.");
    expect(entryDayNotice(tiles[7])).toMatch(/Online booking is paused/);
    expect(entryDayNotice(tiles[0])).toBeNull();
    expect(nextOpenDate(rows, "2026-11-21")).toBeNull();
    expect(nextOpenDate([...rows, row("2026-11-27", "available")], "2026-11-21")).toBe("2026-11-27");
  });

  test("E-3 a weekday price is dimmed on Saturday with the rule, never hidden; counts for it are dropped", () => {
    expect(weekdayRuleText([0, 1, 2, 3])).toBe("Mon to Thu only");
    expect(weekdayRuleText([5, 6])).toBe("Sat and Sun only");
    expect(weekdayRuleText([0, 2, 4])).toBe("Mon, Wed and Fri only");
    expect(weekdayRuleText([0, 1, 2, 3, 4, 5, 6])).toBeNull();
    const perOption = new Map<string, EntryDayRow[]>([
      [STUDENT, [row("2026-11-21", "wrong_weekday", 0, "wrong_weekday")]],
    ]);
    const sat = entryOptionRows(offer!.options, "2026-11-21", perOption);
    expect(sat.map((r) => r.usable)).toEqual([true, false]);
    expect(sat[1].rule).toBe("Mon to Thu only");
    expect(optionUnavailableLine(sat[1], "2026-11-21")).toBe(
      "Student & NYSC is for Mon to Thu. On Saturday it isn't available.",
    );
    expect(quoteLinesFor(sat, { [WALKIN]: 2, [STUDENT]: 1 })).toEqual([{ priceOptionId: WALKIN, guests: 2 }]);
  });

  test("E-4 the ID note shows only when a guest is on a price that needs ID", () => {
    const thu = entryOptionRows(offer!.options, "2026-11-19", new Map());
    expect(idCheckNote(thu, { [WALKIN]: 2 })).toBeNull();
    expect(idCheckNote(thu, { [WALKIN]: 2, [STUDENT]: 1 })).toBe(
      "Bring a valid Student or NYSC ID. It's checked at the gate.",
    );
  });

  test("E-5 steppers stay inside each price's guest range; problems are words", () => {
    const opt = { ...offer!.options[0], guestMin: 2, guestMax: 4 };
    expect(stepCount(opt, 0, 1)).toBe(2);
    expect(stepCount(opt, 4, 1)).toBe(4);
    expect(stepCount(opt, 2, -1)).toBe(0);
    const tiles = entryDayTiles([row("2026-11-19", "available", 3)], "2026-11-19", 1);
    expect(entrySelectionProblem(tiles[0], {})).toBe("Add at least one guest.");
    expect(entrySelectionProblem(tiles[0], { [WALKIN]: 5 })).toBe("Only 3 places are left on Thu 19 Nov.");
    expect(entrySelectionProblem(tiles[0], { [WALKIN]: 2 })).toBeNull();
  });

  test("E-6 VAT added shows a VAT line; included shows it under the total; none shows nothing", () => {
    const lines = [{ name: "Walk-in", guests: 2, baseMinor: 1000000, totalMinor: 1075000 }];
    const added = summaryLines(lines, {
      currencyCode: "NGN", exponent: 2, taxMinor: 75000, feeMinor: 0, totalMinor: 1075000, vatMode: "added", vatRatePct: 7.5,
    });
    expect(added.map((l) => `${l.label}=${l.value}`)).toEqual(["2 × Walk-in=₦10,000", "VAT 7.5%=₦750", "Total=₦10,750"]);
    const included = summaryLines([{ ...lines[0], totalMinor: 1000000 }], {
      currencyCode: "NGN", exponent: 2, taxMinor: 69767, feeMinor: 0, totalMinor: 1000000, vatMode: "included", vatRatePct: 7.5,
    });
    expect(included.map((l) => l.label)).toEqual(["2 × Walk-in", "Total", "Includes VAT 7.5%"]);
    expect(vatModeLine({ mode: "none", ratePct: 0 })).toBeNull();
    expect(vatModeLine({ mode: "added", ratePct: 7.5 })).toBe("Prices are before 7.5% VAT, added at checkout.");
    expect(impliedVatRatePct({ taxMinor: 105000, totalMinor: 1505000, feeMinor: 0 })).toBe(7.5);
  });

  test("E-7 the booking page: pay with a live hold, hold ran out, checking, pass, cancelled", () => {
    const base = {
      groupId: GROUP,
      reference: "VB-1",
      state: "instant_payment_pending",
      version: 2,
      currencyCode: "NGN",
      totalMinor: 1505000,
      amountDueNowMinor: 1505000,
      holdUntil: "2026-11-19T02:00:00Z",
      venue: { name: "Gameland QA", timezone: "Africa/Lagos" },
      offer: { name: "Entry" },
      window: { localDate: "2026-11-19", startsAt: "2026-11-19T11:00:00Z", endsAt: "2026-11-19T23:00:00Z" },
      lines: [{ priceOptionId: WALKIN, name: "Walk-in", guests: 2 }],
      passes: [],
    };
    const before = Date.parse("2026-11-19T01:45:00Z");
    expect(visitViewFor(parseEntryBooking(base)!, before)).toEqual({
      kind: "pay", amountMinor: 1505000, holdUntil: "2026-11-19T02:00:00Z",
    });
    expect(visitViewFor(parseEntryBooking(base)!, Date.parse("2026-11-19T02:00:01Z")).kind).toBe("hold_expired");
    expect(visitViewFor(parseEntryBooking({ ...base, state: "reconciliation_required" })!, before).kind).toBe("checking");
    expect(visitViewFor(parseEntryBooking({ ...base, state: "finalizing" })!, before).kind).toBe("confirming");
    expect(visitViewFor(parseEntryBooking({ ...base, state: "confirmed" })!, before).kind).toBe("confirmed");
    expect(visitViewFor(parseEntryBooking({ ...base, state: "cancelled" })!, before)).toEqual({ kind: "cancelled", partial: false });
    expect(holdUntilText("2026-11-19T02:00:00Z", "Africa/Lagos")).toBe("On hold until 03:00");
    expect(countdownText(14 * 60 + 5)).toBe("14:05 left");
    expect(parseEntryBooking({ ...base, state: "made_up" })).toBeNull();
  });

  test("E-8 the refund preview in plain words", () => {
    const preview = {
      groupId: GROUP, previewIds: ["p"], previewHash: "h", currencyCode: "NGN",
      paymentCollection: "mingla", expiresAt: null,
    };
    expect(refundPreviewWords({ ...preview, paidMinor: 1505000, refundMinor: 752500, keepMinor: 752500 }, 2, "Gameland QA")).toBe(
      "You paid ₦15,050. You get ₦7,525 back. Gameland QA keeps ₦7,525 under its terms.",
    );
    expect(refundPreviewWords({ ...preview, paidMinor: 1505000, refundMinor: 1505000, keepMinor: 0 }, 2, "Gameland QA")).toBe(
      "You paid ₦15,050. You get all of it back.",
    );
    expect(refundPreviewWords({ ...preview, paidMinor: 1505000, refundMinor: 0, keepMinor: 1505000 }, 2, "Gameland QA")).toMatch(
      /nothing comes back/,
    );
  });

  test("E-9 every server code is words, never the code", () => {
    for (const code of [
      "offer_sold_out", "offer_hold_expired", "offer_booking_not_found", "offer_payment_already_pending",
      "offer_amount_too_large", "offer_wrong_weekday", "rate_limited", "something_new_and_unknown",
    ]) {
      const words = venueOfferErrorCopy(code);
      expect(words).not.toMatch(/_/);
      expect(words.length).toBeGreaterThan(10);
    }
    expect(venueOfferErrorCopy("offer_sold_out", 3)).toBe(
      "Only 3 places are left that day. Lower the number of guests or choose another day.",
    );
  });
});

describe("#4490 P2-6 checkout address and public routes", () => {
  test("C-1 the checkout address carries the day and counts only, and parses back strictly", () => {
    const path = entryCheckoutPath({
      brandSlug: "harmattan-qa-local", venueSlug: "gamelandqa", offerId: OFFER,
      date: "2026-11-19", counts: { [WALKIN]: 2, [STUDENT]: 1, junk: 3 },
    });
    expect(path).toBe(
      `/b/harmattan-qa-local/v/gamelandqa/book/${OFFER}?date=2026-11-19&q=${encodeURIComponent(`${WALKIN}:2,${STUDENT}:1`)}`,
    );
    expect(path).not.toMatch(/token|#t=/);
    const q = new URLSearchParams(path.split("?")[1]);
    // TEST-MOD-APPROVED #4490 (fix round 2, N85): the address may carry the timed session too (null when none).
    expect(parseEntryCheckoutParams({ date: q.get("date"), q: q.get("q") })).toEqual({
      date: "2026-11-19",
      counts: { [WALKIN]: 2, [STUDENT]: 1 },
      windowId: null,
    });
    // TEST-MOD-APPROVED #4490 (fix round 2, N85): no session in the address reads as null.
    expect(parseEntryCheckoutParams({ date: "19/11/2026", q: "x:1,y" })).toEqual({ date: null, counts: {}, windowId: null });
  });

  test("C-2 /visit/ is public and segment-safe; /visitor is not; it is not an ad pixel page", () => {
    expect(isPublicBuyerRoute(`/visit/${GROUP}`)).toBe(true);
    expect(isPublicBuyerRoute("/visitor")).toBe(false);
    expect(isPublicBuyerRoute("/b/x/v/y/book/z")).toBe(true);
    expect(isAdPixelRoute(`/visit/${GROUP}`)).toBe(false);
  });
});

describe("#4490 P2-6 the booking token on this device", () => {
  const TOKEN = `l4490.${"A".repeat(43)}`;
  // A tiny browser stand-in (this suite runs in node): storage, location and
  // history.replaceState that rewrites the location like a browser does.
  class FakeStorage {
    private map = new Map<string, string>();
    getItem(k: string): string | null { return this.map.has(k) ? (this.map.get(k) as string) : null; }
    setItem(k: string, v: string): void { this.map.set(k, String(v)); }
    removeItem(k: string): void { this.map.delete(k); }
    clear(): void { this.map.clear(); }
  }
  const installWindow = (): void => {
    const location = { pathname: "/", search: "", hash: "" };
    const history = {
      state: null as unknown,
      replaceState(_state: unknown, _title: string, url: string): void {
        const parsed = new URL(url, "http://127.0.0.1:8491");
        location.pathname = parsed.pathname;
        location.search = parsed.search;
        location.hash = parsed.hash;
      },
    };
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: new FakeStorage(),
      sessionStorage: new FakeStorage(),
      location,
      history,
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    };
  };
  beforeEach(() => {
    installWindow();
  });
  afterAll(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  test("T-1 the fragment token is kept per booking and scrubbed from the address", () => {
    jest.useFakeTimers();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tokens = require("../../../utils/venueOfferBookingTokens") as typeof import("../../../utils/venueOfferBookingTokens");
    window.history.replaceState(null, "", `/visit/${GROUP}#t=${TOKEN}`);
    expect(tokens.adoptFragmentToken(GROUP)).toBe(TOKEN);
    jest.runAllTimers();
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe(`/visit/${GROUP}`);
    expect(tokens.readVenueOfferBookingToken(GROUP)).toBe(TOKEN);
    expect(tokens.readVenueOfferBookingToken("41e6ca72-acab-4f77-907c-000000000000")).toBeNull();
    expect(tokens.tokenFromFragment("#t=not-a-token")).toBeNull();
    jest.useRealTimers();
  });

  test("T-2 the payment-return query is scrubbed; the open payment page is remembered for this tab only", () => {
    jest.useFakeTimers();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tokens = require("../../../utils/venueOfferBookingTokens") as typeof import("../../../utils/venueOfferBookingTokens");
    window.history.replaceState(null, "", `/visit/${GROUP}?paid=1&reference=mingla_stay_x`);
    tokens.scrubVisitAddress({ dropQuery: true });
    jest.runAllTimers();
    expect(window.location.search).toBe("");
    tokens.rememberVenueOfferPayUrl(GROUP, "https://checkout.example/abc");
    expect(tokens.recallVenueOfferPayUrl(GROUP)).toBe("https://checkout.example/abc");
    tokens.rememberVenueOfferPayUrl(GROUP, "javascript:alert(1)");
    expect(tokens.recallVenueOfferPayUrl(GROUP)).toBe("https://checkout.example/abc");
    expect(tokens.venueOfferCartKey()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokens.venueOfferCartKey()).toBe(tokens.venueOfferCartKey());
    jest.useRealTimers();
  });
});
