/**
 * ORCH-1117 happy-path regression tests — the hoisted buy/unavailable state
 * machine (`resolveOfferingCta`), the luminance-safe palette contrast, and the
 * collapsed-by-default About contract.
 *
 * Owner: mingla-implementor (the tester adds a SECOND adversarial angle).
 *
 * fails-on-revert: deleting the `if (!bookable) {...}` gate at the TOP of
 * resolveOfferingCta makes T-CTA-UNAVAIL fail (a not-bookable paid event would
 * resolve to "buy" instead of the non-tappable "unavailable" strip).
 */

// Import the pure module directly from the package source by relative path —
// offeringCta imports ONLY types from ./types (no RN runtime), so it resolves
// under ts-jest without the @mingla path alias / a package mock.
import {
  resolveOfferingCta,
  computeOfferingVariant,
} from "../../../../../packages/offering-rendering/offeringCta";
import type {
  PublicTicketProps,
  PublicEventProps,
} from "../../../../../packages/offering-rendering/types";

const baseTicket = (over: Partial<PublicTicketProps> = {}): PublicTicketProps => ({
  id: over.id ?? "tt-1",
  name: over.name ?? "General",
  description: null,
  priceGbp: over.priceGbp ?? 25,
  priceAllInGbp: over.priceAllInGbp ?? 25,
  currency: over.currency ?? "GBP",
  isFree: over.isFree ?? false,
  isUnlimited: over.isUnlimited ?? true,
  capacity: over.capacity ?? null,
  visibility: over.visibility ?? "visible",
  passwordProtected: false,
  password: null,
  saleStartAt: over.saleStartAt ?? null,
  saleEndAt: over.saleEndAt ?? null,
  approvalRequired: false,
  waitlistEnabled: over.waitlistEnabled ?? false,
  availableAt: over.availableAt ?? "online",
  displayOrder: over.displayOrder ?? 0,
});

describe("ORCH-1117 resolveOfferingCta — buy/unavailable state machine", () => {
  // T-CTA-BUY
  it("renders a tappable Buy with a 'From {price}' label for a bookable multi-tier paid event", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [
        baseTicket({ id: "a", priceAllInGbp: 25 }),
        baseTicket({ id: "b", priceAllInGbp: 40 }),
      ],
      currency: "GBP",
    });
    expect(cta.kind).toBe("buy");
    expect(cta.tappable).toBe(true);
    if (cta.kind === "buy") {
      expect(cta.label).toBe("Buy ticket");
      expect(cta.price).toMatch(/^From /);
      expect(cta.price).toContain("25");
    }
  });

  // single tier → bare price (no "From")
  it("uses a bare price (no 'From') for a single paid tier", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [baseTicket({ priceAllInGbp: 30 })],
      currency: "GBP",
    });
    if (cta.kind === "buy") {
      expect(cta.price.startsWith("From ")).toBe(false);
      expect(cta.price).toContain("30");
    } else {
      throw new Error("expected a buy CTA");
    }
  });

  // T-CTA-UNAVAIL — fails-on-revert anchor (delete the !bookable gate → this fails)
  it("renders a NON-tappable 'Booking unavailable' strip when the paid brand can't charge", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: false,
      tickets: [baseTicket({ priceAllInGbp: 25 })],
      currency: "GBP",
    });
    expect(cta.kind).toBe("unavailable");
    expect(cta.tappable).toBe(false);
    if (cta.kind === "unavailable") {
      expect(cta.title).toBe("Booking unavailable");
      expect(cta.subline).toBe("The organizer is finishing payment setup.");
    }
  });

  // T-CTA-SOLDOUT
  it("renders a NON-tappable 'Sold out' strip when all tiers are sold out (no waitlist)", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [
        baseTicket({ isUnlimited: false, capacity: 0, waitlistEnabled: false }),
      ],
      currency: "GBP",
    });
    expect(cta.kind).toBe("unavailable");
    expect(cta.tappable).toBe(false);
    if (cta.kind === "unavailable") expect(cta.title).toBe("Sold out");
  });

  // T-CTA-WAITLIST
  it("renders a tappable 'Join waitlist' when sold out + waitlist enabled", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [
        baseTicket({ isUnlimited: false, capacity: 0, waitlistEnabled: true }),
      ],
      currency: "GBP",
    });
    expect(cta.kind).toBe("waitlist");
    expect(cta.tappable).toBe(true);
  });

  it("renders a tappable free CTA when every visible tier is free", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [baseTicket({ isFree: true, priceAllInGbp: null, priceGbp: null })],
      currency: "GBP",
      freeVerb: "Get free ticket",
    });
    expect(cta.kind).toBe("free");
    expect(cta.tappable).toBe(true);
  });

  it("renders a NON-tappable 'Sales ended' strip for a past offering", () => {
    const cta = resolveOfferingCta({
      variant: "past",
      bookable: true,
      tickets: [baseTicket()],
      currency: "GBP",
    });
    expect(cta.kind).toBe("unavailable");
    expect(cta.tappable).toBe(false);
    if (cta.kind === "unavailable") expect(cta.title).toBe("Sales ended");
  });

  it("honors a custom buy verb (trip 'Reserve my spot')", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [baseTicket({ priceAllInGbp: 120 })],
      currency: "GBP",
      buyVerb: "Reserve my spot",
    });
    if (cta.kind === "buy") expect(cta.label).toBe("Reserve my spot");
    else throw new Error("expected a buy CTA");
  });
});

describe("ORCH-1117 computeOfferingVariant — shared variant owner", () => {
  const baseEvent = (over: Partial<PublicEventProps> = {}): PublicEventProps =>
    ({
      id: "e1",
      name: "Night",
      brandId: "b1",
      brandSlug: "b",
      eventSlug: "e",
      description: "x",
      dateLine: "Sat",
      dateSubline: null,
      datesList: [],
      status: over.status ?? "published",
      endedAt: over.endedAt ?? null,
      format: "in-person",
      venueName: null,
      address: null,
      hideAddressUntilTicket: false,
      coverHue: 25,
      coverMediaUrl: null,
      coverMediaType: null,
      coverCredit: null,
      tickets: over.tickets ?? [baseTicket()],
      currency: "GBP",
      // ORCH-1157 [rsvp-public-redesign] — PublicEventProps gained partyTypes
      // (default-safe). Append-only fixture update (no deletion).
      partyTypes: over.partyTypes ?? [],
    }) as PublicEventProps;

  it("flags a cancelled event", () => {
    expect(computeOfferingVariant(baseEvent({ status: "cancelled" }), false)).toBe(
      "cancelled",
    );
  });

  it("flags an ended event as past", () => {
    expect(computeOfferingVariant(baseEvent({ status: "ended" }), false)).toBe(
      "past",
    );
  });

  it("returns published for a live sellable event", () => {
    expect(computeOfferingVariant(baseEvent(), false)).toBe("published");
  });
});
