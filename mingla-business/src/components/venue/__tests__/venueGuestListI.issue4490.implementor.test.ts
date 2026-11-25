/**
 * #4490 spec 07-I — guest-list client contract and signed-out surface.
 * [TEST-MOD-APPROVED #4490] W3 fix 1: the source-text pins moved to the additive gate .github/scripts/strict-grep/issue-4490-host-wiring.mjs (I-PROPOSED-1047).
 */
import { VenueOfferError, mapGuestListDay, mapScanOutcome, mapVenueDay } from "../../../services/venueOffersService";
import { featureSetFrom } from "../../../types/venueFeatures";
import type { PromoterGuestListPage } from "../../../types/venueOffers";
import { checkInResultView } from "../features/checkin/venueCheckInResult";
import {
  promoterGuestListErrorCopy,
  promoterGuestListTermsLine,
} from "../features/guestlist/guestListModel";
import { deriveVenueNav } from "../venueModules";


describe("07-I guest-list mapping", () => {
  it("maps private terms, counts, promoter grouping and entries", () => {
    const day = mapGuestListDay({
      venueId: "venue-1",
      localDate: "2026-11-21",
      terms: {
        venueId: "venue-1",
        freeUntil: "23:00",
        reducedUntil: "00:30",
        reducedPriceOptionId: "price-1",
        reducedPrice: { optionId: "price-1", offeringId: "offer-1", name: "Guest list", priceMinor: 250000, currencyCode: "NGN" },
        plusOnesMax: 3,
        closesMinutesBefore: 60,
        version: 2,
      },
      entries: [{ id: "entry-1", venueId: "venue-1", localDate: "2026-11-21", guestName: "Ada", plusOnes: 2, addedByKind: "promoter", promoterId: "promoter-1", promoterName: "Musa", arrived: 1, status: "on_list", version: 1 }],
      promoters: [{ id: "promoter-1", name: "Musa", active: true, version: 1, names: 3, in: 1 }],
      counts: { names: 3, in: 1 },
    });
    expect(day.counts).toEqual({ names: 3, in: 1 });
    expect(day.entries[0]).toEqual(expect.objectContaining({ guestName: "Ada", plusOnes: 2, promoterName: "Musa" }));
    expect(day.terms.reducedPrice).toEqual(expect.objectContaining({ offeringId: "offer-1", priceMinor: 250000 }));
  });

  it("carries the server's guest-list totals into Today", () => {
    const day = mapVenueDay({ checkIn: {}, guestList: { names: 34, in: 12 }, money: null });
    expect(day.guestList).toEqual({ names: 34, in: 12 });
  });
});

describe("07-I door", () => {
  it("maps the reduced-price handoff and the free-admission undo result", () => {
    const sell = mapScanOutcome({ result: "sell", kind: "guest_list", guestListEntryId: "entry-1", priceOptionId: "price-1", offeringId: "offer-1", count: 3, entry: { id: "entry-1", guestName: "Ada", plusOnes: 2 } });
    expect(sell).toEqual(expect.objectContaining({ result: "sell", kind: "guest_list", priceOptionId: "price-1", count: 3 }));

    const admitted = mapScanOutcome({ result: "admitted", kind: "guest_list", admitted: 3, logId: "log-1", entry: { id: "entry-1", guestName: "Ada", plusOnes: 2 } });
    expect(checkInResultView(admitted)).toEqual(expect.objectContaining({ title: "Guest list checked in", subject: "Ada · Guest list × 3", secondary: "undo" }));
  });

});

describe("07-I navigation and promoter copy", () => {
  it("shows Guest list, Today and Check-in only when the feature is on", () => {
    const off = deriveVenueNav({ features: featureSetFrom({}), activeSpaceCount: 0 });
    const on = deriveVenueNav({ features: featureSetFrom({ guest_list: true }), activeSpaceCount: 0 });
    expect(off).not.toContain("guestlist");
    expect(on).toEqual(expect.arrayContaining(["guestlist", "today", "checkin"]));
  });

  it("uses the approved terms and closed-list copy", () => {
    const page = {
      nights: [{ localDate: "2026-11-21", terms: { freeUntil: "23:00", reducedUntil: "00:30", reducedPrice: { priceMinor: 250000, currencyCode: "NGN" } }, entries: [] }],
    } as unknown as PromoterGuestListPage;
    expect(promoterGuestListTermsLine(page, "2026-11-21")).toBe("Free before 23:00, ₦2,500 before 00:30");
    expect(promoterGuestListErrorCopy(new VenueOfferError("guest_list_closed"))).toBe("The list for tonight has closed.");
  });

});
