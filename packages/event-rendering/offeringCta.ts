// offeringCta — ORCH-1117 [public offering page polish].
//
// The SINGLE source of truth for the buy/unavailable state machine that BOTH
// the inline `PublicTicketRow` per-tier predicates AND the new floating Buy bar
// consume. Hoisted out of PublicEventPage so the gate logic (`bookable`,
// sold-out, ended, pre-sale, door-only, free, paid) lives in ONE place and the
// floating bar can never drift from the inline row's notion of "buyable".
//
// Pure module: no React, no RN, no side effects. Self-contained inline price
// formatting mirrors PublicEventPage.formatTicketPrice (all-in, never recompute
// fees — WYSIWYP). The floating bar uses the PAGE-LEVEL projection
// (`resolveOfferingCta`); the inline row keeps its per-tier label by reusing the
// shared sub-predicates exported here.

import type { PublicEventProps, PublicTicketProps } from "./types";

/** A single ticket's per-tier sale-state sub-predicates (shared with the row). */
export const ticketSaleEnded = (ticket: PublicTicketProps): boolean =>
  ticket.saleEndAt !== null &&
  Number.isFinite(new Date(ticket.saleEndAt).getTime()) &&
  new Date(ticket.saleEndAt).getTime() <= Date.now();

export const ticketIsSoldOut = (ticket: PublicTicketProps): boolean =>
  !ticket.isUnlimited && (ticket.capacity ?? 0) === 0;

export const ticketIsDoorOnly = (ticket: PublicTicketProps): boolean =>
  ticket.availableAt === "door";

/** The page-level offering variant (matches PublicEventPage's `Variant`). */
export type OfferingVariant =
  | "published"
  | "sold-out"
  | "pre-sale"
  | "past"
  | "password-gate"
  | "cancelled";

/**
 * Compute the page-level offering variant from the event payload. Single owner:
 * PublicEventPage's internal `computeVariant` delegates here, and host adapters
 * (e.g. the buyer-web event floating bar) reuse the SAME computation so the bar
 * can never disagree with the inline page about cancelled/past/pre-sale/sold-out.
 * `password-gate` is page-render-only state and is resolved by PublicEventPage;
 * for the bar's purposes a password-gated event is treated as "published".
 */
export const computeOfferingVariant = (
  event: PublicEventProps,
  passwordUnlocked: boolean,
): OfferingVariant => {
  if (event.status === "cancelled") return "cancelled";
  const isPast =
    event.status === "ended" ||
    (event.endedAt !== null && new Date(event.endedAt).getTime() < Date.now());
  if (isPast) return "past";
  const visibleTickets = event.tickets.filter((t) => t.visibility !== "hidden");
  const requiresPassword = visibleTickets.some((t) => t.passwordProtected);
  if (requiresPassword && !passwordUnlocked) return "password-gate";
  const allPreSale =
    visibleTickets.length > 0 &&
    visibleTickets.every(
      (t) =>
        t.saleStartAt !== null &&
        new Date(t.saleStartAt).getTime() > Date.now(),
    );
  if (allPreSale) return "pre-sale";
  const allSoldOut =
    visibleTickets.length > 0 &&
    visibleTickets.every((t) => !t.isUnlimited && (t.capacity ?? 0) === 0);
  if (allSoldOut) return "sold-out";
  return "published";
};

/**
 * The resolved floating-bar state. `tappable:false` states are rendered as a
 * NON-button info strip (Constitution #1 — no dead taps). `tappable:true`
 * states render the accent action button.
 */
export type CtaState =
  | { kind: "buy"; label: string; price: string; tappable: true }
  | { kind: "free"; label: string; tappable: true }
  | { kind: "waitlist"; label: string; tappable: true }
  | {
      kind: "unavailable";
      title: string;
      subline: string | null;
      tappable: false;
    };

export interface ResolveOfferingCtaInput {
  /** The page-level computed variant. */
  variant: OfferingVariant;
  /**
   * I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED (ORCH-1076) — the brand can charge.
   * Gated FIRST: a not-ready paid brand is "Booking unavailable" regardless of
   * ticket state. Callers that cannot resolve `bookable` pass `true` (fail-open;
   * the checkout 409 / cart-toast remains the terminal backstop).
   */
  bookable: boolean;
  /** The visible (non-hidden) tickets, already display-sorted. */
  tickets: PublicTicketProps[];
  /** Fallback currency when a ticket omits its own. */
  currency: string;
  /**
   * The action verb for the buyable accent button on a NON-event offering
   * (trip: "Reserve my spot"; experience: "Get my spot"). Events default to
   * "Buy ticket" / "Get free ticket". Optional — events omit it.
   */
  buyVerb?: string;
  freeVerb?: string;
}

const formatPrice = (
  ticket: PublicTicketProps,
  fallbackCurrency: string,
): string | null => {
  if (ticket.isFree) return "Free";
  const price = ticket.priceAllInGbp ?? ticket.priceGbp;
  if (price === null || price === undefined) return null;
  const currency = ticket.currency ?? fallbackCurrency;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
};

/**
 * Resolve the page-level floating-bar CTA state. Precedence mirrors the inline
 * `PublicTicketRow` state machine + adds the `bookable` gate FIRST:
 *
 *   !bookable                 → unavailable("Booking unavailable" + subline)
 *   variant past              → unavailable("Sales ended")
 *   variant pre-sale          → unavailable("On sale soon")
 *   variant cancelled         → unavailable("Cancelled")
 *   all door-only             → unavailable("Pay at the door")
 *   all sold-out + any wl     → waitlist("Join waitlist")
 *   all sold-out              → unavailable("Sold out")
 *   any free, none paid       → free(freeVerb ?? "Get free ticket")
 *   else                      → buy(buyVerb ?? "Buy ticket", "From {price}")
 */
export const resolveOfferingCta = (
  input: ResolveOfferingCtaInput,
): CtaState => {
  const { variant, bookable, tickets, currency, buyVerb, freeVerb } = input;

  if (!bookable) {
    return {
      kind: "unavailable",
      title: "Booking unavailable",
      subline: "The organizer is finishing payment setup.",
      tappable: false,
    };
  }

  if (variant === "cancelled") {
    return {
      kind: "unavailable",
      title: "Cancelled",
      subline: null,
      tappable: false,
    };
  }

  if (variant === "past") {
    return {
      kind: "unavailable",
      title: "Sales ended",
      subline: null,
      tappable: false,
    };
  }

  if (variant === "pre-sale") {
    return {
      kind: "unavailable",
      title: "On sale soon",
      subline: null,
      tappable: false,
    };
  }

  const visible = tickets.filter((t) => t.visibility !== "hidden");

  if (visible.length === 0) {
    return {
      kind: "unavailable",
      title: "Not on sale yet",
      subline: null,
      tappable: false,
    };
  }

  if (visible.every(ticketIsDoorOnly)) {
    return {
      kind: "unavailable",
      title: "Pay at the door",
      subline: null,
      tappable: false,
    };
  }

  if (visible.every(ticketSaleEnded)) {
    return {
      kind: "unavailable",
      title: "Sales ended",
      subline: null,
      tappable: false,
    };
  }

  const allSoldOut = visible.every(ticketIsSoldOut);
  if (allSoldOut) {
    if (visible.some((t) => t.waitlistEnabled)) {
      return { kind: "waitlist", label: "Join waitlist", tappable: true };
    }
    return {
      kind: "unavailable",
      title: "Sold out",
      subline: null,
      tappable: false,
    };
  }

  // Sellable tickets = visible, not sold-out, not door-only, sale not ended.
  const sellable = visible.filter(
    (t) =>
      !ticketIsSoldOut(t) && !ticketIsDoorOnly(t) && !ticketSaleEnded(t),
  );
  const considered = sellable.length > 0 ? sellable : visible;

  const anyPaid = considered.some((t) => !t.isFree);
  if (!anyPaid) {
    return {
      kind: "free",
      label: freeVerb ?? "Get free ticket",
      tappable: true,
    };
  }

  // Lowest visible all-in price across the paid (non-free) sellable tickets.
  const paidPrices = considered
    .filter((t) => !t.isFree)
    .map((t) => formatPrice(t, currency))
    .filter((p): p is string => p !== null);
  const paidTierCount = considered.filter((t) => !t.isFree).length;
  // "From" only when >1 priced tier; a single tier shows the bare price.
  const lowest = lowestPriceString(considered, currency);
  const priceText =
    paidTierCount > 1 && lowest !== null
      ? `From ${lowest}`
      : (lowest ?? paidPrices[0] ?? "");

  return {
    kind: "buy",
    label: buyVerb ?? "Buy ticket",
    price: priceText,
    tappable: true,
  };
};

/** Lowest numeric all-in price among paid tickets, formatted, or null. */
const lowestPriceString = (
  tickets: PublicTicketProps[],
  fallbackCurrency: string,
): string | null => {
  let lowestTicket: PublicTicketProps | null = null;
  let lowestValue = Number.POSITIVE_INFINITY;
  for (const t of tickets) {
    if (t.isFree) continue;
    const value = t.priceAllInGbp ?? t.priceGbp;
    if (value === null || value === undefined) continue;
    if (value < lowestValue) {
      lowestValue = value;
      lowestTicket = t;
    }
  }
  if (lowestTicket === null) return null;
  return formatPrice(lowestTicket, fallbackCurrency);
};
