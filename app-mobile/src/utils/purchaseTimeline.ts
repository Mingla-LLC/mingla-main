export type PurchaseKind = "order" | "rsvp" | "reservation" | "venue_order";
export type PurchaseCoverMediaType = "image" | "video" | "gif";

export interface PurchaseOrderSource {
  id: string;
  eventId: string;
  eventTitle: string;
  eventType: string | null;
  brandName: string;
  coverMediaUrl: string | null;
  coverMediaType?: PurchaseCoverMediaType | null;
  startAt: string | null;
  endAt: string | null;
  timezone: string;
  venueLine: string | null;
  paymentStatus: string;
  ticketCount: number;
  validTicketCount: number;
  source: string | null;
  currency: string;
  buyerTotalCents: number;
  refundedAmountCents: number;
  raw: unknown;
}

export interface PurchaseRsvpSource {
  id: string;
  eventId: string;
  eventTitle: string;
  brandName: string;
  coverMediaUrl: string | null;
  coverMediaType?: PurchaseCoverMediaType | null;
  startAt: string | null;
  endAt: string | null;
  timezone: string;
  venueLine: string | null;
  status: string;
  approvalStatus: string;
  guestCount: number;
  raw: unknown;
}

export interface PurchaseReservationSource {
  id: string;
  title: string;
  coverMediaUrl: string | null;
  coverMediaType?: PurchaseCoverMediaType | null;
  startAt: string;
  timezone: string;
  venueLine: string | null;
  status: string;
  partySize: number;
  feeCents: number;
  currency: string;
  refundedAmountCents: number;
  raw: unknown;
}

export interface PurchaseVenueOrderSource {
  id: string;
  title: string;
  coverMediaUrl: string | null;
  coverMediaType?: PurchaseCoverMediaType | null;
  createdAt: string;
  timezone: string;
  venueLine: string | null;
  paymentStatus: string;
  totalCents: number;
  refundedAmountCents: number;
  currency: string;
  raw: unknown;
}

export interface PurchaseSources {
  orders: readonly PurchaseOrderSource[];
  rsvps: readonly PurchaseRsvpSource[];
  reservations: readonly PurchaseReservationSource[];
  venueOrders: readonly PurchaseVenueOrderSource[];
}

export interface PurchaseTimelineItem {
  key: string;
  id: string;
  kind: PurchaseKind;
  title: string;
  brandName: string | null;
  coverMediaUrl: string | null;
  coverMediaType: PurchaseCoverMediaType | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  venueLine: string | null;
  status: string;
  count: number;
  amountCents: number | null;
  refundedAmountCents: number;
  currency: string | null;
  source: string | null;
  raw: unknown;
}

export interface PurchaseGroup {
  key: string;
  title: string;
  items: PurchaseTimelineItem[];
}

export interface PurchaseTimeline {
  upcoming: PurchaseGroup[];
  past: PurchaseGroup[];
}

const TERMINAL_ORDER_STATUSES = new Set(["refunded", "cancelled"]);
const TERMINAL_RESERVATION_STATUSES = new Set([
  "cancelled",
  "no_show",
  "completed",
]);

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fallbackEnd(start: Date, hours: number): Date {
  return new Date(start.getTime() + hours * 60 * 60 * 1000);
}

function partsKey(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function monthLabel(date: Date, timeZone: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: "long", timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(date);
  }
}

function groupDescriptor(
  item: PurchaseTimelineItem,
  now: Date,
  locale: string,
): { key: string; title: string } {
  const startsAt = new Date(item.startsAt);
  const tonightThreshold = now.getTime() - 6 * 60 * 60 * 1000;
  const isTonight =
    startsAt.getTime() >= tonightThreshold &&
    partsKey(startsAt, item.timezone) === partsKey(now, item.timezone);
  if (isTonight) return { key: "tonight", title: "Tonight" };
  const monthKey = partsKey(startsAt, item.timezone).slice(0, 7);
  return {
    key: `month:${monthKey}`,
    title: monthLabel(startsAt, item.timezone, locale),
  };
}

function groupItems(
  items: PurchaseTimelineItem[],
  now: Date,
  locale: string,
): PurchaseGroup[] {
  const groups = new Map<string, PurchaseGroup>();
  for (const item of items) {
    const descriptor = groupDescriptor(item, now, locale);
    const group = groups.get(descriptor.key) ?? {
      key: descriptor.key,
      title: descriptor.title,
      items: [],
    };
    group.items.push(item);
    groups.set(descriptor.key, group);
  }
  return [...groups.values()];
}

function orderItems(orders: readonly PurchaseOrderSource[]): PurchaseTimelineItem[] {
  return orders.flatMap((order) => {
    const start = validDate(order.startAt) ?? validDate(order.endAt);
    if (!start) return [];
    const end = validDate(order.endAt) ?? fallbackEnd(start, 4);
    return [{
      key: `order:${order.id}:${start.toISOString()}`,
      id: order.id,
      kind: "order" as const,
      title: order.eventTitle,
      brandName: order.brandName,
      coverMediaUrl: order.coverMediaUrl,
      coverMediaType: order.coverMediaType ?? null,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      timezone: order.timezone || "UTC",
      venueLine: order.venueLine,
      status: order.paymentStatus,
      count: order.ticketCount,
      amountCents: order.buyerTotalCents,
      refundedAmountCents: order.refundedAmountCents,
      currency: order.currency,
      source: order.source,
      raw: order.raw,
    }];
  });
}

function rsvpItems(rsvps: readonly PurchaseRsvpSource[]): PurchaseTimelineItem[] {
  return rsvps.flatMap((rsvp) => {
    const start = validDate(rsvp.startAt) ?? validDate(rsvp.endAt);
    if (!start) return [];
    const end = validDate(rsvp.endAt) ?? fallbackEnd(start, 4);
    return [{
      key: `rsvp:${rsvp.id}`,
      id: rsvp.id,
      kind: "rsvp" as const,
      title: rsvp.eventTitle,
      brandName: rsvp.brandName,
      coverMediaUrl: rsvp.coverMediaUrl,
      coverMediaType: rsvp.coverMediaType ?? null,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      timezone: rsvp.timezone || "UTC",
      venueLine: rsvp.venueLine,
      status: rsvp.approvalStatus === "approved" ? rsvp.status : "pending",
      count: Math.max(1, rsvp.guestCount),
      amountCents: null,
      refundedAmountCents: 0,
      currency: null,
      source: null,
      raw: rsvp.raw,
    }];
  });
}

function reservationItems(
  reservations: readonly PurchaseReservationSource[],
): PurchaseTimelineItem[] {
  return reservations.flatMap((reservation) => {
    const start = validDate(reservation.startAt);
    if (!start) return [];
    return [{
      key: `reservation:${reservation.id}`,
      id: reservation.id,
      kind: "reservation" as const,
      title: reservation.title,
      brandName: reservation.title,
      coverMediaUrl: reservation.coverMediaUrl,
      coverMediaType: reservation.coverMediaType ?? null,
      startsAt: start.toISOString(),
      endsAt: fallbackEnd(start, 2).toISOString(),
      timezone: reservation.timezone || "UTC",
      venueLine: reservation.venueLine,
      status: reservation.status,
      count: reservation.partySize,
      amountCents: reservation.feeCents,
      refundedAmountCents: reservation.refundedAmountCents,
      currency: reservation.currency,
      source: null,
      raw: reservation.raw,
    }];
  });
}

function venueOrderItems(
  venueOrders: readonly PurchaseVenueOrderSource[],
): PurchaseTimelineItem[] {
  return venueOrders.flatMap((order) => {
    const createdAt = validDate(order.createdAt);
    if (!createdAt) return [];
    return [{
      key: `venue_order:${order.id}`,
      id: order.id,
      kind: "venue_order" as const,
      title: order.title,
      brandName: order.title,
      coverMediaUrl: order.coverMediaUrl,
      coverMediaType: order.coverMediaType ?? null,
      startsAt: createdAt.toISOString(),
      endsAt: createdAt.toISOString(),
      timezone: order.timezone || "UTC",
      venueLine: order.venueLine,
      status: order.paymentStatus,
      count: 1,
      amountCents: order.totalCents,
      refundedAmountCents: order.refundedAmountCents,
      currency: order.currency,
      source: null,
      raw: order.raw,
    }];
  });
}

function isUpcoming(item: PurchaseTimelineItem, now: Date): boolean {
  if (item.kind === "venue_order") return false;
  if (item.kind === "order" && TERMINAL_ORDER_STATUSES.has(item.status)) return false;
  if (
    item.kind === "reservation" &&
    TERMINAL_RESERVATION_STATUSES.has(item.status)
  ) return false;
  return new Date(item.endsAt).getTime() >= now.getTime();
}

/**
 * #4063 — Pure purchases partition. Server data stays in React Query and is
 * converted here into one deterministic timeline for Profile and Purchases.
 */
export function buildPurchaseTimeline(
  sources: PurchaseSources,
  now: Date,
  locale = "en",
): PurchaseTimeline {
  const all = [
    ...orderItems(sources.orders),
    ...rsvpItems(sources.rsvps),
    ...reservationItems(sources.reservations),
    ...venueOrderItems(sources.venueOrders),
  ];
  const upcoming = all
    .filter((item) => isUpcoming(item, now))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const past = all
    .filter((item) => !isUpcoming(item, now))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  return {
    upcoming: groupItems(upcoming, now, locale),
    past: groupItems(past, now, locale),
  };
}
