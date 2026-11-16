/**
 * issue #4420 public-page audit (wave 2 items 1, 3, 4) — behaviour.
 *
 *   P-1 the bar's price reads "From Free" when any ticket on sale is free;
 *       otherwise the lowest price, with "From" only when prices differ;
 *   P-2 a title long enough to be clamped on the phone cover is flagged so
 *       the page body prints it in full; a short one is not;
 *   P-3 the desktop glass bar docks inside the LEFT flyer column (fixed,
 *       left edge = the page's content edge, width capped at the flyer's),
 *       so it can never sit over the right column's text.
 *
 * Fails-on-revert: dropping the free check fails P-1 ("$75"); counting tiers
 * instead of distinct prices fails P-1's same-price case; removing the
 * clamp flag fails P-2; a right-anchored dock fails P-3.
 */
import { resolveOfferingCta } from "@mingla/offering-rendering/offeringCta";
import { coverTitleMayClamp } from "@mingla/offering-rendering/OfferingCoverIdentity";
import { premiumDesktopBarDock } from "@mingla/offering-rendering/offeringFrameMetrics";

type Ticket = Parameters<typeof resolveOfferingCta>[0]["tickets"][number];

const ticket = (id: string, price: number | null, extra: Partial<Ticket> = {}): Ticket =>
  ({
    id,
    name: id,
    priceGbp: price,
    priceAllInGbp: price,
    isFree: price === 0,
    visibility: "public",
    capacity: 10,
    isUnlimited: false,
    saleEndAt: null,
    availableAt: "online",
    waitlistEnabled: false,
    ...extra,
  }) as Ticket;

const cta = (tickets: Ticket[]) =>
  resolveOfferingCta({
    variant: "published",
    bookable: true,
    tickets,
    currency: "USD",
  });

describe("issue #4420 audit — public offering pages", () => {
  test("P-1 the bar price: From Free, From lowest, or the one price", () => {
    const mixed = cta([ticket("Community", 0), ticket("Standard", 75), ticket("VIP", 120)]);
    expect(mixed.kind).toBe("buy");
    if (mixed.kind === "buy") expect(mixed.price).toBe("From Free");

    const paid = cta([ticket("Standard", 75), ticket("VIP", 120)]);
    if (paid.kind !== "buy") throw new Error("expected buy");
    expect(paid.price.startsWith("From ")).toBe(true);
    expect(paid.price).toContain("75");

    const samePrice = cta([ticket("Early", 40), ticket("Door", 40)]);
    if (samePrice.kind !== "buy") throw new Error("expected buy");
    expect(samePrice.price.startsWith("From")).toBe(false);
    expect(samePrice.price).toContain("40");

    const one = cta([ticket("Standard", 25)]);
    if (one.kind !== "buy") throw new Error("expected buy");
    expect(one.price.startsWith("From")).toBe(false);
  });

  test("P-2 a long title is flagged for the full title in the body", () => {
    expect(
      coverTitleMayClamp(
        "An Extraordinarily Long Evening Title For A Late Summer Rooftop Gathering Of Photographers",
      ),
    ).toBe(true);
    expect(coverTitleMayClamp("Sunday Sketch & Sip")).toBe(false);
  });

  test("P-3 the desktop bar docks in the left flyer column", () => {
    const dock = premiumDesktopBarDock(22);
    expect(dock.position).toBe("fixed");
    expect(dock.bottom).toBe(22);
    expect(dock).not.toHaveProperty("right");
    expect(dock.left).toContain("calc(");
    expect(dock.left).toContain("+ 40px");
    expect(dock.width).toContain("min(420px");
    expect(dock.width).toContain("* 0.4");
  });
});
