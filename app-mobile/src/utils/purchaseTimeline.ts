export type PurchaseKind =
  | "order"
  | "rsvp"
  | "reservation"
  | "venue_order"
  // #4473 — only shared stays are listed here; owned stays live on /stay.
  | "stay"
  // #4490 Explorer W2 — venue bookings (passes), plans and waitlist places.
  | "venue_booking"
  | "venue_membership"
  | "venue_waitlist";
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
  /** #4473 — shows here because this account proved its contact; read-only. */
  shared?: boolean;
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
  /** #4473 — shows here because this account proved its contact; read-only. */
  shared?: boolean;
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
  /** #4473 — shows here because this account proved its contact; read-only. */
  shared?: boolean;
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
  /** #4473 — shows here because this account proved its contact; read-only. */
  shared?: boolean;
  raw: unknown;
}

/** #4473 — a shared stay: venue, reference, state and mode; no dates. */
export interface PurchaseStaySource {
  id: string;
  title: string;
  createdAt: string;
  timezone: string;
  venueLine: string | null;
  state: string;
  shared?: boolean;
  raw: unknown;
}

/** #4490 Explorer W2 — a venue booking (a pass): entry, group, hire, by the hour. */
export interface PurchaseVenueBookingSource {
  id: string;
  title: string;
  brandName: string | null;
  venueLine: string | null;
  startAt: string | null;
  endAt: string | null;
  timezone: string;
  state: string;
  guests: number;
  totalMinor: number;
  refundedMinor: number;
  currency: string;
  raw: unknown;
}

/** #4490 Explorer W2 — a venue plan (membership). */
export interface PurchaseVenueMembershipSource {
  id: string;
  title: string;
  brandName: string | null;
  venueLine: string | null;
  startAt: string | null;
  endAt: string | null;
  timezone: string;
  status: string;
  /** W2-N19: the plan's own date line ("Paid until …"). */
  whenText?: string | null;
  raw: unknown;
}

/** #4490 Explorer W2 — a place in a venue's waitlist. */
export interface PurchaseVenueWaitlistSource {
  id: string;
  title: string;
  venueLine: string | null;
  startAt: string | null;
  createdAt: string | null;
  timezone: string;
  status: string;
  partySize: number;
  raw: unknown;
}

export interface PurchaseSources {
  orders: readonly PurchaseOrderSource[];
  rsvps: readonly PurchaseRsvpSource[];
  reservations: readonly PurchaseReservationSource[];
  venueOrders: readonly PurchaseVenueOrderSource[];
  stays?: readonly PurchaseStaySource[];
  venueBookings?: readonly PurchaseVenueBookingSource[];
  venueMemberships?: readonly PurchaseVenueMembershipSource[];
  venueWaitlist?: readonly PurchaseVenueWaitlistSource[];
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
  /** #4473 — shows here because this account proved its contact; read-only. */
  shared?: boolean;
  /**
   * #4490 W2-N19 — the row's date line when the start is not the date that
   * matters (a plan reads "Paid until Sun 21 Nov 2027"). Unset for every
   * other kind, which keeps the start's day and time.
   */
  whenText?: string | null;
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

// #4490 W2-N28: a month in another year carries its year ("November 2027"),
// for every purchase kind; this year's months stay a bare "November".
function monthLabel(
  date: Date,
  timeZone: string,
  locale: string,
  withYear = false,
): string {
  const options: Intl.DateTimeFormatOptions = withYear
    ? { month: "long", year: "numeric" }
    : { month: "long" };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);
  }
}

/** The venue's own hour (0-23) of an instant. */
function localHour(date: Date, timeZone: string): number | null {
  try {
    const hour = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date);
    const n = Number.parseInt(hour, 10);
    return Number.isFinite(n) ? n % 24 : null;
  } catch {
    return null;
  }
}

// #4490 W2-N21: venue items follow spec 06 §6's day words in the venue's
// zone: "Tonight" from 17:00, "Today" before it. Other kinds keep "Tonight"
// for anything later today.
const VENUE_KINDS = new Set<PurchaseKind>(["venue_booking", "venue_membership", "venue_waitlist"]);
const TONIGHT_FROM_HOUR = 17;

function groupDescriptor(
  item: PurchaseTimelineItem,
  now: Date,
  locale: string,
  dayWords: boolean,
): { key: string; title: string } {
  const startsAt = new Date(item.startsAt);
  const tonightThreshold = now.getTime() - 6 * 60 * 60 * 1000;
  const isTonight =
    dayWords &&
    startsAt.getTime() >= tonightThreshold &&
    partsKey(startsAt, item.timezone) === partsKey(now, item.timezone);
  if (isTonight && VENUE_KINDS.has(item.kind)) {
    const hour = localHour(startsAt, item.timezone);
    if (hour !== null && hour < TONIGHT_FROM_HOUR) return { key: "today", title: "Today" };
  }
  if (isTonight) return { key: "tonight", title: "Tonight" };
  const monthKey = partsKey(startsAt, item.timezone).slice(0, 7);
  const otherYear = monthKey.slice(0, 4) !== partsKey(now, item.timezone).slice(0, 4);
  return {
    key: `month:${monthKey}`,
    title: monthLabel(startsAt, item.timezone, locale, otherYear),
  };
}

function groupItems(
  items: PurchaseTimelineItem[],
  now: Date,
  locale: string,
  dayWords = true,
): PurchaseGroup[] {
  const groups = new Map<string, PurchaseGroup>();
  for (const item of items) {
    const descriptor = groupDescriptor(item, now, locale, dayWords);
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
      amountCents: order.shared ? null : order.buyerTotalCents,
      refundedAmountCents: order.refundedAmountCents,
      currency: order.currency,
      source: order.source,
      shared: order.shared === true,
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
      shared: rsvp.shared === true,
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
      amountCents: reservation.shared ? null : reservation.feeCents,
      refundedAmountCents: reservation.refundedAmountCents,
      currency: reservation.currency,
      source: null,
      shared: reservation.shared === true,
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
      amountCents: order.shared ? null : order.totalCents,
      refundedAmountCents: order.refundedAmountCents,
      currency: order.currency,
      source: null,
      shared: order.shared === true,
      raw: order.raw,
    }];
  });
}

function stayItems(stays: readonly PurchaseStaySource[]): PurchaseTimelineItem[] {
  return stays.flatMap((stay) => {
    const createdAt = validDate(stay.createdAt);
    if (!createdAt) return [];
    return [{
      key: `stay:${stay.id}`,
      id: stay.id,
      kind: "stay" as const,
      title: stay.title,
      brandName: stay.title,
      coverMediaUrl: null,
      coverMediaType: null,
      startsAt: createdAt.toISOString(),
      endsAt: createdAt.toISOString(),
      timezone: stay.timezone || "UTC",
      venueLine: stay.venueLine,
      status: stay.state,
      count: 1,
      amountCents: null,
      refundedAmountCents: 0,
      currency: null,
      source: null,
      shared: stay.shared === true,
      raw: stay.raw,
    }];
  });
}

function venueBookingItems(
  bookings: readonly PurchaseVenueBookingSource[],
): PurchaseTimelineItem[] {
  return bookings.flatMap((booking) => {
    const start = validDate(booking.startAt);
    if (!start) return [];
    const end = validDate(booking.endAt) ?? fallbackEnd(start, 4);
    return [{
      key: `venue_booking:${booking.id}`,
      id: booking.id,
      kind: "venue_booking" as const,
      title: booking.title,
      brandName: booking.brandName,
      coverMediaUrl: null,
      coverMediaType: null,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      timezone: booking.timezone || "UTC",
      venueLine: booking.venueLine,
      status: booking.state,
      count: Math.max(1, booking.guests),
      amountCents: booking.totalMinor,
      refundedAmountCents: booking.refundedMinor,
      currency: booking.currency,
      source: null,
      raw: booking.raw,
    }];
  });
}

function venueMembershipItems(
  memberships: readonly PurchaseVenueMembershipSource[],
): PurchaseTimelineItem[] {
  return memberships.flatMap((membership) => {
    const start = validDate(membership.startAt);
    if (!start) return [];
    const end = validDate(membership.endAt) ?? start;
    return [{
      key: `venue_membership:${membership.id}`,
      whenText: membership.whenText ?? null,
      id: membership.id,
      kind: "venue_membership" as const,
      title: membership.title,
      brandName: membership.brandName,
      coverMediaUrl: null,
      coverMediaType: null,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      timezone: membership.timezone || "UTC",
      venueLine: membership.venueLine,
      status: membership.status,
      count: 1,
      amountCents: null,
      refundedAmountCents: 0,
      currency: null,
      source: null,
      raw: membership.raw,
    }];
  });
}

function venueWaitlistItems(
  places: readonly PurchaseVenueWaitlistSource[],
): PurchaseTimelineItem[] {
  return places.flatMap((place) => {
    const start = validDate(place.startAt) ?? validDate(place.createdAt);
    if (!start) return [];
    return [{
      key: `venue_waitlist:${place.id}`,
      id: place.id,
      kind: "venue_waitlist" as const,
      title: place.title,
      brandName: null,
      coverMediaUrl: null,
      coverMediaType: null,
      startsAt: start.toISOString(),
      endsAt: fallbackEnd(start, 2).toISOString(),
      timezone: place.timezone || "UTC",
      venueLine: place.venueLine,
      status: place.status,
      count: Math.max(1, place.partySize),
      amountCents: null,
      refundedAmountCents: 0,
      currency: null,
      source: null,
      raw: place.raw,
    }];
  });
}

// #4490 Explorer W2: a venue booking that ended in one of these states is past.
const FINISHED_VENUE_BOOKING_STATES = new Set([
  "cancelled",
  "declined",
  "request_expired",
]);
// A plan is current while one of these holds, whatever its dates say.
const LIVE_VENUE_MEMBERSHIP_STATES = new Set([
  "pending",
  "active",
  "payment_due",
  "grace",
  "paused",
  "requested",
]);
const OPEN_VENUE_WAITLIST_STATES = new Set(["waiting", "notified"]);

const FINISHED_STAY_STATES = new Set([
  "cancelled",
  "completed",
  "checked_out",
  "expired",
  "declined",
  "no_show",
]);

function isUpcoming(item: PurchaseTimelineItem, now: Date): boolean {
  if (item.kind === "venue_order") return false;
  if (item.kind === "venue_membership") {
    return LIVE_VENUE_MEMBERSHIP_STATES.has(item.status);
  }
  if (item.kind === "venue_waitlist") {
    // W2-N11: an open place whose day has passed (venue zone) is past.
    return OPEN_VENUE_WAITLIST_STATES.has(item.status) &&
      partsKey(new Date(item.startsAt), item.timezone) >= partsKey(now, item.timezone);
  }
  if (
    item.kind === "venue_booking" &&
    FINISHED_VENUE_BOOKING_STATES.has(item.status)
  ) return false;
  // A stay carries no dates here; its state says whether it is still ahead.
  if (item.kind === "stay") return !FINISHED_STAY_STATES.has(item.status);
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
    ...stayItems(sources.stays ?? []),
    ...venueBookingItems(sources.venueBookings ?? []),
    ...venueMembershipItems(sources.venueMemberships ?? []),
    ...venueWaitlistItems(sources.venueWaitlist ?? []),
  ];
  const upcoming = all
    .filter((item) => isUpcoming(item, now))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const past = all
    .filter((item) => !isUpcoming(item, now))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  return {
    upcoming: groupItems(upcoming, now, locale),
    // #4490 W2-N37: Past is grouped by month only. "Tonight" / "Today" are
    // for what is still coming; a place left (or a booking cancelled) for
    // later today is not "Tonight" in Past. Shared by every kind.
    past: groupItems(past, now, locale, false),
  };
}
