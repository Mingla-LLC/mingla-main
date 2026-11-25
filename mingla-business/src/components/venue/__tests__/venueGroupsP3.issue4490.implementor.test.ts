/**
 * #4490 P3-3 — the guest's group package: reading the package offer, the day
 * strip from one row per start time (too-soon days explained), start chips
 * that say why they're off, the option that fits the group, the summary with
 * extras, VAT, pay now and pay later (D P3: ₦140,000 + VAT ₦10,500 =
 * ₦150,500, ₦75,250 now), the checkout address round trip, the balance card
 * and a change's money in words, and the F4 "at the venue / gate only" flag.
 */
import {
  answersPayload,
  balanceCardWords,
  bestRowPerDay,
  depositWords,
  guestChangeWords,
  leadText,
  missingAnswer,
  optionForGuests,
  packageCheckoutPath,
  packageDayNotice,
  packageDayTiles,
  packageSummaryLines,
  parsePackageBooking,
  parsePackageCheckoutParams,
  parsePackageOfferDetail,
  parsePackageQuote,
  startChipsFor,
} from "@mingla/brand-rendering/venueOffers/packageModel";
import { parseEntryOfferDetail, venueOfferErrorCopy, type EntryDayRow } from "@mingla/brand-rendering/venueOffers/entryModel";

const OFFER = {
  id: "99db630f-8890-4311-9727-2aa8646555c2",
  kind: "group_package",
  name: "Squad",
  summary: "3 hours of games",
  minNoticeMinutes: 4320,
  options: [{ id: "11111111-1111-4111-8111-111111111111", name: "Squad", unit: "guest", guestMin: 10, guestMax: 60, priceMinor: 1_000_000 }],
  policy: {
    refundLadder: [{ minMinutesBefore: 1440, refundBps: 10000 }],
    dateChangeRule: { allowedUntilMinutesBefore: 1440, guestChangeUntilMinutesBefore: 2880, maxChanges: 1 },
  },
  inclusions: [
    { kind: "perk", label: "3 hours of games" },
    { kind: "choice", label: "Rice for the group", options: ["Party jollof", "Coconut rice", "Native rice"] },
  ],
  extras: [{ id: "xe2d3d25a0b", name: "Cake table", priceMinor: 2_000_000, per: "booking" }],
  deposit: { kind: "percent", value: 5000, balanceDueDaysBefore: 2 },
  payModes: ["deposit", "full"],
  startTimes: ["12:00", "14:00", "16:00", "18:00"],
  durationMinutes: 180,
  currencyCode: "NGN",
  minorUnitExponent: 2,
  vat: { mode: "added", ratePct: 7.5 },
  venue: { name: "Gameland QA", timezone: "Africa/Lagos", countryCode: "NG" },
  canCollectOnline: true,
};

const QUOTE = {
  quoteId: "1a2b3a74-65cd-476d-986c-3619e52e75f4",
  currencyCode: "NGN",
  subtotalMinor: 14_000_000,
  taxMinor: 1_050_000,
  feeMinor: 0,
  totalMinor: 15_050_000,
  vat: { mode: "added", ratePct: 7.5, amountMinor: 1_050_000 },
  lines: [{ priceOptionId: "11111111-1111-4111-8111-111111111111", name: "Squad", guests: 12, baseMinor: 14_000_000, packageMinor: 12_000_000, extrasMinor: 2_000_000, taxMinor: 1_050_000, totalMinor: 15_050_000 }],
  extras: [{ id: "xe2d3d25a0b", name: "Cake table", per: "booking", qty: 1, amountMinor: 2_000_000 }],
  payPlan: { payModes: ["deposit", "full"], depositMinor: 7_525_000, balanceDueAt: "2026-11-26T15:00:00+00:00", depositKind: "percent", depositValue: 5000, collapsed: null },
};

function row(date: string, startsAtHour: number, status: EntryDayRow["status"], remaining = 200): EntryDayRow {
  const h = String(startsAtHour - 1).padStart(2, "0");
  return {
    localDate: date,
    startsAt: `${date}T${h}:00:00+00:00`,
    endsAt: `${date}T${String(startsAtHour + 2).padStart(2, "0")}:00:00+00:00`,
    windowId: `w-${date}-${startsAtHour}`,
    status,
    reason: null,
    remaining,
    priceMinor: 1_000_000,
  };
}

describe("#4490 P3-3 the package offer", () => {
  const offer = parsePackageOfferDetail(OFFER);

  it("reads inclusions, the choice, extras, deposit, pay modes and start times", () => {
    expect(offer).not.toBeNull();
    expect(offer?.inclusions.map((i) => i.kind)).toEqual(["perk", "choice"]);
    expect(offer?.extras[0]).toEqual({ id: "xe2d3d25a0b", name: "Cake table", priceMinor: 2_000_000, per: "booking" });
    expect(offer?.deposit).toEqual({ kind: "percent", value: 5000, balanceDueDaysBefore: 2 });
    expect(offer?.payModes).toEqual(["deposit", "full"]);
    expect(offer?.guestChangeUntilMinutes).toBe(2880);
    expect(offer?.canCollectOnline).toBe(true);
  });

  it("an entry offer is not read as a package; F4 flag reads on entry too", () => {
    expect(parsePackageOfferDetail({ ...OFFER, kind: "entry" })).toBeNull();
    expect(parseEntryOfferDetail({ ...OFFER, kind: "entry", canCollectOnline: false })?.canCollectOnline).toBe(false);
  });

  it("picks the price that fits the group (price by group size), none outside the range", () => {
    const options = [
      { id: "a", name: "10 to 20", guestMin: 10, guestMax: 20, weekdays: null, startTime: null, endTime: null, idCheckLabel: null, priceMinor: 1 },
      { id: "b", name: "21 to 60", guestMin: 21, guestMax: 60, weekdays: null, startTime: null, endTime: null, idCheckLabel: null, priceMinor: 2 },
    ];
    expect(optionForGuests(options, 12)?.id).toBe("a");
    expect(optionForGuests(options, 40)?.id).toBe("b");
    expect(optionForGuests(options, 61)).toBeNull();
  });

  it("asks for every choice and sends answers keyed by the question", () => {
    if (offer === null) throw new Error("no offer");
    expect(missingAnswer(offer, {})).toBe("Rice for the group");
    expect(answersPayload(offer, { 0: 0 })).toEqual({ "Rice for the group": "Party jollof" });
    expect(missingAnswer(offer, { 0: 1 })).toBeNull();
  });
});

describe("#4490 P3-3 days and start times", () => {
  const rows = [
    row("2026-11-20", 12, "too_soon"),
    row("2026-11-20", 16, "too_soon"),
    row("2026-11-28", 12, "sold_out", 0),
    row("2026-11-28", 16, "available", 288),
    row("2026-11-28", 18, "available", 5),
  ];

  it("one tile per day stands for its best start time; days inside the lead time are explained", () => {
    expect(bestRowPerDay(rows).map((r) => `${r.localDate}:${r.status}`)).toEqual(["2026-11-20:too_soon", "2026-11-28:available"]);
    const tiles = packageDayTiles(rows, "2026-11-20", 9);
    expect(tiles[0].state).toBe("too_soon");
    expect(tiles[0].soldOnline).toBe(false);
    expect(packageDayNotice(tiles[0], 4320)).toBe("Groups book 3 days ahead, so Fri 20 Nov can't be booked online.");
    expect(tiles[8].soldOnline).toBe(true);
  });

  it("start chips are never hidden: a taken time or one without room for the group says so", () => {
    const chips = startChipsFor(rows, "2026-11-28", 12, "Africa/Lagos");
    expect(chips.map((c) => `${c.time}:${c.usable}:${c.note}`)).toEqual(["12:00:false:Taken", "16:00:true:null", "18:00:false:5 left"]);
  });

  it("says 24 hours, not 1 day", () => {
    expect(leadText(1440)).toBe("24 hours");
    expect(leadText(4320)).toBe("3 days");
  });
});

describe("#4490 P3-3 the summary and how you pay", () => {
  const quote = parsePackageQuote(QUOTE);

  it("D P3 totals: ₦140,000 + VAT ₦10,500 = ₦150,500, ₦75,250 now", () => {
    expect(quote?.packageMinor).toBe(12_000_000);
    expect(quote?.payPlan.depositMinor).toBe(7_525_000);
    if (quote === null) throw new Error("no quote");
    const lines = packageSummaryLines(quote, {
      exponent: 2,
      offerName: "Squad",
      guests: 12,
      unit: "guest",
      payNowMinor: 7_525_000,
      laterMinor: 7_525_000,
      laterBy: "Thu 26 Nov",
    });
    expect(lines.map((l) => `${l.label}=${l.value}`)).toEqual([
      "12 × Squad=₦120,000",
      "Cake table=₦20,000",
      "VAT 7.5%=₦10,500",
      "Total=₦150,500",
      "Pay now=₦75,250",
      "Pay by Thu 26 Nov=₦75,250",
    ]);
  });

  it("names the deposit choice", () => {
    expect(depositWords({ depositKind: "percent", depositValue: 5000, depositMinor: 1 }, "NGN", 2)).toBe("Half now");
    expect(depositWords({ depositKind: "percent", depositValue: 3000, depositMinor: 1 }, "NGN", 2)).toBe("30% now");
    expect(depositWords({ depositKind: "fixed", depositValue: 5_000_000, depositMinor: 5_000_000 }, "NGN", 2)).toBe("₦50,000 now");
  });
});

describe("#4490 P3-3 the checkout address", () => {
  it("round-trips the choice with nothing personal in it", () => {
    const path = packageCheckoutPath({
      brandSlug: "harmattan-qa-local",
      venueSlug: "gamelandqa",
      offerId: OFFER.id,
      date: "2026-11-28",
      windowId: "b66dcb51-eb98-42d2-a935-e0862968c31e",
      guests: 12,
      extras: ["xe2d3d25a0b"],
      answers: { 0: 0 },
      payMode: "deposit",
    });
    expect(path).toBe(
      "/b/harmattan-qa-local/v/gamelandqa/book/99db630f-8890-4311-9727-2aa8646555c2?k=group&d=2026-11-28&w=b66dcb51-eb98-42d2-a935-e0862968c31e&g=12&x=xe2d3d25a0b&a=0.0&pay=deposit",
    );
    const params = Object.fromEntries(new URL(`http://x${path}`).searchParams.entries());
    expect(parsePackageCheckoutParams(params)).toEqual({
      date: "2026-11-28",
      windowId: "b66dcb51-eb98-42d2-a935-e0862968c31e",
      guests: 12,
      extras: ["xe2d3d25a0b"],
      answers: { 0: 0 },
      payMode: "deposit",
    });
    expect(parsePackageCheckoutParams({ date: "2026-11-28", q: "x:1" })).toBeNull();
    expect(parsePackageCheckoutParams({ ...params, w: "not-a-uuid" })).toBeNull();
  });
});

describe("#4490 P3-3 the booking: balance and changes", () => {
  const raw = {
    offerKind: "group_package",
    window: { windowId: "w1" },
    totalMinor: 15_050_000,
    totalDueMinor: 17_200_000,
    balanceDueMinor: 2_150_000,
    balanceDueAt: "2026-11-26T15:00:00+00:00",
    paidOnlineMinor: 15_050_000,
    lines: [{ guests: 14, unit: "guest", unitPriceMinor: 1_000_000, packageMinor: 12_000_000 }],
    extras: [{ id: "xe2d3d25a0b", name: "Cake table", per: "booking", qty: 1, amountMinor: 2_000_000 }],
    answers: { "Rice for the group": "Party jollof" },
    inclusions: [{ kind: "perk", label: "3 hours of games" }, { kind: "choice", label: "Rice for the group" }],
    changeRules: { canMove: true, canChangeGuests: true, canAddExtras: true, changesUsed: 0, maxChanges: 1 },
  };
  const pkg = parsePackageBooking(raw);

  it("reads the money and the package as it stands after a change", () => {
    expect(pkg.packageMinor).toBe(14_000_000);
    expect(pkg.guests).toBe(14);
    expect(pkg.balanceDueMinor).toBe(2_150_000);
    expect(pkg.inclusions.map((i) => i.label)).toEqual(["3 hours of games"]);
    expect(pkg.answers).toEqual([{ question: "Rice for the group", answer: "Party jollof" }]);
    expect(parsePackageBooking({ totalMinor: 100, paidMinor: 100 }).balanceDueMinor).toBe(0);
  });

  it("the balance card says how much and by when, or that it's overdue", () => {
    const opts = { currencyCode: "NGN", exponent: 2, timeZone: "Africa/Lagos" };
    expect(balanceCardWords(pkg, { ...opts, now: Date.parse("2026-11-20T00:00:00Z") })?.title).toBe("Balance ₦21,500 due Thu 26 Nov");
    expect(balanceCardWords(pkg, { ...opts, now: Date.parse("2026-11-27T00:00:00Z") })?.overdue).toBe(true);
    expect(balanceCardWords({ balanceDueMinor: 0, balanceDueAt: null }, { ...opts, now: 0 })).toBeNull();
  });

  it("shows the price of a change before the guest confirms it", () => {
    const words = guestChangeWords(
      { amountMinor: 2_150_000, taxDeltaMinor: 150_000, feeMinor: 0, refundMinor: 0, totalDueAfterMinor: 17_200_000, balanceAfterMinor: 2_150_000, currencyCode: "NGN", groupVersion: 5, toGuests: 14, toDate: null },
      2,
    );
    expect(words.title).toBe("₦21,500 more (₦20,000 + VAT ₦1,500)");
    expect(words.body).toBe("New total ₦172,000. Left to pay after this: ₦21,500.");
  });

  it("every new guest error code has words, never a raw code", () => {
    for (const code of ["offer_answer_required", "offer_extra_unavailable", "offer_pay_mode_unavailable", "offer_nothing_to_pay", "offer_payment_already_paid", "offer_change_not_allowed", "offer_change_too_late", "offer_change_nothing"]) {
      expect(venueOfferErrorCopy(code)).not.toMatch(/offer_|wrong on our side/);
    }
  });
});
