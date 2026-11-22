/**
 * #4490 Explorer W3 fix round 2 (W3-N16, W3-N17) — the Host Offers list says
 * the same "from" the guest page says.
 *
 *   H-1  a live entry offer whose busy-time price checkout really charges is
 *        cheaper than every listed price: the list says "from" that price;
 *   H-2  a busy rule no slot starts in: the server's "from" equals the base
 *        price and the list is unchanged;
 *   H-3  a group package with a cheaper per-booking option: per guest, never
 *        the per-booking amount worded "a guest";
 *   H-4  by the hour and private hire follow the server's amount and unit;
 *   H-5  a draft or paused offer (no guest "from") lists the host's own prices,
 *        exactly as before;
 *   M-1  the list read maps `guestFrom` from the server and drops a malformed one.
 *
 * FAILS-ON-REVERT: ignoring `offer.guestFrom` in priceColumn fails H-1, H-3 and
 * H-4; deleting `guestFrom: mapGuestFrom(o.guestFrom)` in mapOffer fails M-1.
 */
import { priceColumn } from "../features/offers/offersModel";
import { mapOffer } from "../../../services/venueOffersService";
import type { VenueOffer, VenuePriceOption } from "../../../types/venueOffers";

const option = (over: Partial<VenuePriceOption>): VenuePriceOption =>
  ({
    id: "o1",
    version: 1,
    name: "Adult",
    unit: "guest",
    guestMin: 1,
    guestMax: 6,
    priceMinor: 400000,
    weekdays: [],
    startTime: null,
    endTime: null,
    eligibility: null,
    busyRules: [],
    sortOrder: 0,
    ...over,
  }) as VenuePriceOption;

const offer = (over: Partial<VenueOffer>): VenueOffer =>
  ({ kind: "entry", options: [option({})], guestFrom: null, ...over }) as unknown as VenueOffer;

describe("#4490 W3 fix 2 — the Host list's from is the guest page's (W3-N16)", () => {
  it("H-1 a reachable busy-time price below every listed price", () => {
    expect(priceColumn(offer({ guestFrom: { fromMinor: 150000, unit: "guest" } }), "NGN")).toBe("from ₦1,500 per guest");
  });
  it("H-2 the same price as the list: unchanged", () => {
    expect(priceColumn(offer({ guestFrom: { fromMinor: 400000, unit: "guest" } }), "NGN")).toBe("₦4,000 per guest");
  });
  it("H-3 a package with a cheaper per-booking option reads per guest", () => {
    const pkg = offer({
      kind: "group_package",
      options: [option({ guestMin: 8, guestMax: 20, priceMinor: 1200000 }), option({ id: "o2", unit: "booking", guestMin: 8, guestMax: 20, priceMinor: 1000000 })],
      guestFrom: { fromMinor: 1200000, unit: "guest" },
    });
    expect(priceColumn(pkg, "NGN")).toBe("from ₦12,000 a guest · 8–20 guests");
  });
  it("H-4 by the hour and hire follow the server", () => {
    const hour = offer({ kind: "by_the_hour", options: [option({ unit: "hour", priceMinor: 1200000 })], guestFrom: { fromMinor: 900000, unit: "hour" } });
    expect(priceColumn(hour, "NGN")).toBe("from ₦9,000 an hour");
    const hire = offer({
      kind: "private_hire",
      options: [option({ unit: "booking", guestMin: 50, guestMax: 600, priceMinor: 420000000 }), option({ id: "o2", unit: "booking", guestMin: 50, guestMax: 600, priceMinor: 350000000, weekdays: [0, 1, 2, 3] })],
      guestFrom: { fromMinor: 350000000, unit: "booking" },
    });
    expect(priceColumn(hire, "NGN")).toMatch(/^from ₦3,500,000 · /);
  });
  it("H-5 no guest from (draft, paused): the host's own prices as before", () => {
    expect(priceColumn(offer({ options: [option({}), option({ id: "o2", priceMinor: 500000 })] }), "NGN")).toBe("from ₦4,000 per guest");
    expect(priceColumn(offer({}), "NGN")).toBe("₦4,000 per guest");
    expect(priceColumn(offer({ kind: "by_the_hour", options: [option({ unit: "hour", priceMinor: 1200000 })] }), "NGN")).toBe("₦12,000 an hour");
  });
  it("M-1 the list read carries guestFrom; a malformed one is dropped", () => {
    expect(mapOffer({ id: "a", guestFrom: { fromMinor: 150000, unit: "guest" } }).guestFrom).toEqual({ fromMinor: 150000, unit: "guest" });
    expect(mapOffer({ id: "a", guestFrom: { fromMinor: 900000, unit: "hour" } }).guestFrom).toEqual({ fromMinor: 900000, unit: "hour" });
    expect(mapOffer({ id: "a", guestFrom: null }).guestFrom).toBeNull();
    expect(mapOffer({ id: "a", guestFrom: { fromMinor: -1 } }).guestFrom).toBeNull();
    expect(mapOffer({ id: "a" }).guestFrom).toBeNull();
  });
});
