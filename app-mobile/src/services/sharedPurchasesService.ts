/**
 * #4473 — purchases that show on this account because it proved the contact
 * they were bought with, while the buyer's own account keeps them too.
 *
 * Seth's rules for a shared purchase:
 *   - every purchase kind can show on a second proven account;
 *   - it joins the chat and shows in Calendar;
 *   - it is READ-ONLY here: no send, take back, cancel, refund, intake or
 *     "show me as going", and no PDF (the in-app QR only);
 *   - the owner's contact, card and amounts are never sent to this account
 *     (the RPC does not return them, and nothing here invents them).
 *
 * The owner path (`fetchMyOrders` and friends) is untouched; this module only
 * reads `pg_my_shared_purchases` and `pg_my_purchase_share_flags`.
 */
import { supabase } from "./supabase";
import type {
  BusinessEventCalendarRow,
  ConsumerRsvpRow,
  ConsumerTicketRow,
} from "./calendarService";
import type {
  PurchaseCoverMediaType,
  PurchaseKind,
  PurchaseOrderSource,
  PurchaseReservationSource,
  PurchaseRsvpSource,
  PurchaseSources,
  PurchaseStaySource,
  PurchaseVenueOrderSource,
} from "../utils/purchaseTimeline";
import type { MyReservationRow } from "../hooks/useMyReservations";

export type SharedPurchaseKind =
  | "order"
  | "rsvp"
  | "rsvp_guest"
  | "reservation"
  | "stay_group"
  | "venue_order";

export interface SharedTicket {
  id: string;
  ticketIndex: number;
  ticketTypeId: string | null;
  ticketTypeName: string | null;
  status: string;
  approvalStatus: string | null;
  transferState: string | null;
  /** null once a friend holds this ticket. */
  qrCode: string | null;
  eventDateIds: string[];
}

export interface SharedEventDate {
  id: string;
  startAt: string | null;
  endAt: string | null;
  isMaster: boolean;
}

export interface SharedBrand {
  id: string | null;
  slug: string | null;
  name: string | null;
}

export interface SharedPurchase {
  kind: SharedPurchaseKind;
  sourceId: string;
  role: "shared";
  sharedWithAnotherAccount: true;
  sharedAt: string | null;
  title: string;
  offeringType: string | null;
  createdAt: string | null;
  // order + rsvp
  orderId: string | null;
  rsvpId: string | null;
  eventId: string | null;
  eventSlug: string | null;
  coverMediaUrl: string | null;
  coverMediaType: PurchaseCoverMediaType | null;
  timezone: string;
  locationText: string | null;
  city: string | null;
  isOnline: boolean;
  onlineUrl: string | null;
  brand: SharedBrand | null;
  eventDateId: string | null;
  bookedStartAt: string | null;
  eventDates: SharedEventDate[];
  paymentStatus: string | null;
  cancelledAt: string | null;
  source: string | null;
  tickets: SharedTicket[];
  startsAt: string | null;
  endsAt: string | null;
  rsvpStatus: string | null;
  approvalStatus: string | null;
  quantity: number;
  qrCode: string | null;
  checkedIn: boolean;
  // reservation / stay / venue order
  reservationId: string | null;
  stayGroupId: string | null;
  venueOrderId: string | null;
  venueId: string | null;
  venueName: string | null;
  partySize: number;
  status: string | null;
  publicReference: string | null;
  state: string | null;
  mode: string | null;
  pickupCode: string | null;
  orderLabel: string | null;
  fulfillmentStatus: string | null;
}

const KINDS = new Set<SharedPurchaseKind>([
  "order",
  "rsvp",
  "rsvp_guest",
  "reservation",
  "stay_group",
  "venue_order",
]);

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
const num = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const obj = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

function coverType(value: unknown): PurchaseCoverMediaType | null {
  return value === "image" || value === "video" || value === "gif"
    ? value
    : null;
}

function parseTickets(value: unknown): SharedTicket[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    const row = obj(raw);
    const id = str(row?.id);
    if (!row || !id) return [];
    return [{
      id,
      ticketIndex: num(row.ticketIndex, index + 1),
      ticketTypeId: str(row.ticketTypeId),
      ticketTypeName: str(row.ticketTypeName),
      status: str(row.status) ?? "valid",
      approvalStatus: str(row.approvalStatus),
      transferState: str(row.transferState),
      qrCode: str(row.qrCode),
      eventDateIds: Array.isArray(row.eventDateIds)
        ? row.eventDateIds.filter((item): item is string => typeof item === "string")
        : [],
    }];
  });
}

function parseDates(value: unknown): SharedEventDate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const row = obj(raw);
    const id = str(row?.id);
    if (!row || !id) return [];
    return [{
      id,
      startAt: str(row.startAt),
      endAt: str(row.endAt),
      isMaster: row.isMaster === true,
    }];
  });
}

/** Validates the RPC payload; unknown kinds and malformed rows are dropped. */
export function parseSharedPurchases(value: unknown): SharedPurchase[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): SharedPurchase[] => {
    const row = obj(raw);
    if (!row) return [];
    const kind = row.kind as SharedPurchaseKind;
    const sourceId = str(row.sourceId);
    const title = str(row.title);
    if (!KINDS.has(kind) || !sourceId || !title) return [];
    const brand = obj(row.brand);
    return [{
      kind,
      sourceId,
      role: "shared",
      sharedWithAnotherAccount: true,
      sharedAt: str(row.sharedAt),
      title,
      offeringType: str(row.offeringType),
      createdAt: str(row.createdAt),
      orderId: str(row.orderId),
      rsvpId: str(row.rsvpId),
      eventId: str(row.eventId),
      eventSlug: str(row.eventSlug),
      coverMediaUrl: str(row.coverMediaUrl),
      coverMediaType: coverType(row.coverMediaType),
      timezone: str(row.timezone) ?? "UTC",
      locationText: str(row.locationText),
      city: str(row.city),
      isOnline: row.isOnline === true,
      onlineUrl: str(row.onlineUrl),
      brand: brand
        ? { id: str(brand.id), slug: str(brand.slug), name: str(brand.name) }
        : null,
      eventDateId: str(row.eventDateId),
      bookedStartAt: str(row.bookedStartAt),
      eventDates: parseDates(row.eventDates),
      paymentStatus: str(row.paymentStatus),
      cancelledAt: str(row.cancelledAt),
      source: str(row.source),
      tickets: parseTickets(row.tickets),
      startsAt: str(row.startsAt),
      endsAt: str(row.endsAt),
      rsvpStatus: str(row.rsvpStatus),
      approvalStatus: str(row.approvalStatus),
      quantity: Math.max(1, num(row.quantity, 1)),
      qrCode: str(row.qrCode),
      checkedIn: row.checkedIn === true,
      reservationId: str(row.reservationId),
      stayGroupId: str(row.stayGroupId),
      venueOrderId: str(row.venueOrderId),
      venueId: str(row.venueId),
      venueName: str(row.venueName),
      partySize: Math.max(1, num(row.partySize, 1)),
      status: str(row.status),
      publicReference: str(row.publicReference),
      state: str(row.state),
      mode: str(row.mode),
      pickupCode: str(row.pickupCode),
      orderLabel: str(row.orderLabel),
      fulfillmentStatus: str(row.fulfillmentStatus),
    }];
  });
}

export async function fetchMySharedPurchases(): Promise<SharedPurchase[]> {
  const { data, error } = await supabase.rpc("pg_my_shared_purchases");
  if (error) throw error;
  return parseSharedPurchases(data);
}

/** `kind:sourceId` for this account's OWN purchases that also show elsewhere. */
export async function fetchMyPurchaseShareFlags(): Promise<string[]> {
  const { data, error } = await supabase.rpc("pg_my_purchase_share_flags");
  if (error) throw error;
  return (Array.isArray(data) ? data : []).flatMap((raw) => {
    const row = obj(raw);
    const kind = str(row?.kind);
    const sourceId = str(row?.source_id);
    return kind && sourceId ? [`${kind}:${sourceId}`] : [];
  });
}

/** Does an owned purchase (route kind + id) carry a share flag? */
export function isPurchaseShareFlagged(
  flags: readonly string[] | undefined,
  kind: PurchaseKind,
  ids: readonly (string | null | undefined)[],
): boolean {
  if (!flags?.length) return false;
  const kinds = kind === "rsvp" ? ["rsvp", "rsvp_guest"] : [kind];
  return ids.some((id) =>
    !!id && kinds.some((candidate) => flags.includes(`${candidate}:${id}`))
  );
}

/** The Purchases route kind + id for a shared purchase. */
export function sharedPurchaseRoute(
  purchase: SharedPurchase,
): { kind: PurchaseKind; id: string } | null {
  switch (purchase.kind) {
    case "order":
      return { kind: "order", id: purchase.orderId ?? purchase.sourceId };
    case "rsvp":
    case "rsvp_guest":
      return { kind: "rsvp", id: purchase.sourceId };
    case "reservation":
      return { kind: "reservation", id: purchase.reservationId ?? purchase.sourceId };
    case "venue_order":
      return { kind: "venue_order", id: purchase.venueOrderId ?? purchase.sourceId };
    case "stay_group":
      return { kind: "stay", id: purchase.stayGroupId ?? purchase.sourceId };
    default:
      return null;
  }
}

/** The booked (else master, else first) occurrence of a shared order. */
export function sharedOrderWindow(
  purchase: SharedPurchase,
): { startAt: string | null; endAt: string | null } {
  const booked = purchase.eventDateId
    ? purchase.eventDates.find((date) => date.id === purchase.eventDateId)
    : undefined;
  const chosen = booked ??
    purchase.eventDates.find((date) => date.isMaster) ??
    purchase.eventDates[0];
  const experienceStart = purchase.offeringType === "experience"
    ? purchase.bookedStartAt
    : null;
  return {
    startAt: experienceStart ?? chosen?.startAt ?? purchase.bookedStartAt ?? null,
    endAt: chosen?.endAt ?? null,
  };
}

/** Tickets this account can present: valid ones a friend does not hold. */
export function sharedPresentableTickets(purchase: SharedPurchase): SharedTicket[] {
  return purchase.tickets.filter((ticket) => ticket.qrCode !== null);
}

const INACTIVE_RSVP = new Set(["cancelled", "not_going", "declined"]);

/** Shared purchases as Purchases timeline sources, flagged `shared`. */
export function sharedPurchaseSources(
  purchases: readonly SharedPurchase[],
): PurchaseSources {
  const orders: PurchaseOrderSource[] = [];
  const rsvps: PurchaseRsvpSource[] = [];
  const reservations: PurchaseReservationSource[] = [];
  const venueOrders: PurchaseVenueOrderSource[] = [];
  const stays: PurchaseStaySource[] = [];
  for (const purchase of purchases) {
    const route = sharedPurchaseRoute(purchase);
    if (!route) continue;
    if (purchase.kind === "order") {
      const window = sharedOrderWindow(purchase);
      const presentable = sharedPresentableTickets(purchase);
      orders.push({
        id: route.id,
        eventId: purchase.eventId ?? "",
        eventTitle: purchase.title,
        eventType: purchase.offeringType,
        brandName: purchase.brand?.name ?? "",
        coverMediaUrl: purchase.coverMediaUrl,
        coverMediaType: purchase.coverMediaType,
        startAt: window.startAt,
        endAt: window.endAt,
        timezone: purchase.timezone,
        venueLine: purchase.locationText,
        paymentStatus: purchase.cancelledAt
          ? "cancelled"
          : purchase.paymentStatus ?? "paid",
        ticketCount: presentable.length,
        validTicketCount: presentable.filter((ticket) => ticket.status === "valid").length,
        source: purchase.source,
        currency: "USD",
        buyerTotalCents: 0,
        refundedAmountCents: 0,
        shared: true,
        raw: purchase,
      });
    } else if (purchase.kind === "rsvp" || purchase.kind === "rsvp_guest") {
      rsvps.push({
        id: route.id,
        eventId: purchase.eventId ?? "",
        eventTitle: purchase.title,
        brandName: purchase.brand?.name ?? "",
        coverMediaUrl: purchase.coverMediaUrl,
        coverMediaType: purchase.coverMediaType,
        startAt: purchase.startsAt,
        endAt: purchase.endsAt,
        timezone: purchase.timezone,
        venueLine: purchase.locationText,
        status: purchase.rsvpStatus ?? "going",
        approvalStatus: purchase.approvalStatus ?? "approved",
        guestCount: purchase.quantity,
        shared: true,
        raw: purchase,
      });
    } else if (purchase.kind === "reservation" && purchase.startsAt) {
      reservations.push({
        id: route.id,
        title: purchase.venueName ?? purchase.title,
        coverMediaUrl: null,
        coverMediaType: null,
        startAt: purchase.startsAt,
        timezone: purchase.timezone,
        venueLine: null,
        status: purchase.status ?? "confirmed",
        partySize: purchase.partySize,
        feeCents: 0,
        currency: "USD",
        refundedAmountCents: 0,
        shared: true,
        raw: purchase,
      });
    } else if (purchase.kind === "venue_order" && purchase.createdAt) {
      venueOrders.push({
        id: route.id,
        title: purchase.venueName ?? purchase.title,
        coverMediaUrl: null,
        coverMediaType: null,
        createdAt: purchase.createdAt,
        timezone: purchase.timezone,
        venueLine: purchase.orderLabel,
        paymentStatus: purchase.paymentStatus ?? "paid",
        totalCents: 0,
        refundedAmountCents: 0,
        currency: "USD",
        shared: true,
        raw: purchase,
      });
    } else if (purchase.kind === "stay_group" && purchase.createdAt) {
      stays.push({
        id: route.id,
        title: purchase.venueName ?? purchase.title,
        createdAt: purchase.createdAt,
        timezone: purchase.timezone,
        venueLine: purchase.venueName,
        state: purchase.state ?? "confirmed",
        shared: true,
        raw: purchase,
      });
    }
  }
  return { orders, rsvps, reservations, venueOrders, stays };
}

// ── Calendar ───────────────────────────────────────────────────────────────

/** Shared, paid or pending orders as Calendar ticket rows (no PDF, no URL). */
export function sharedCalendarOrders(
  purchases: readonly SharedPurchase[],
): BusinessEventCalendarRow[] {
  return purchases.flatMap((purchase): BusinessEventCalendarRow[] => {
    if (purchase.kind !== "order" || purchase.cancelledAt) return [];
    const paymentStatus = purchase.paymentStatus === "pending" ? "pending" : "paid";
    if (purchase.paymentStatus && !["paid", "pending"].includes(purchase.paymentStatus)) {
      return [];
    }
    const window = sharedOrderWindow(purchase);
    const tickets: ConsumerTicketRow[] = sharedPresentableTickets(purchase).map(
      (ticket) => ({
        id: ticket.id,
        ticketTypeId: ticket.ticketTypeId ?? "",
        qrCode: ticket.qrCode as string,
        status: (["valid", "used", "void", "transferred", "refunded"].includes(ticket.status)
          ? ticket.status
          : "valid") as ConsumerTicketRow["status"],
        attendeeName: null,
        attendeeEmail: null,
        eventDateIds: ticket.eventDateIds,
      }),
    );
    return [{
      orderId: purchase.orderId ?? purchase.sourceId,
      eventId: purchase.eventId ?? "",
      eventTitle: purchase.title,
      eventSlug: purchase.eventSlug ?? "",
      eventType: purchase.offeringType,
      brandName: purchase.brand?.name ?? "",
      brandSlug: purchase.brand?.slug ?? "",
      coverMediaUrl: purchase.coverMediaUrl,
      coverMediaType: purchase.coverMediaType,
      masterDateUtc: window.startAt,
      masterDateEndUtc: window.endAt,
      eventDateId: purchase.eventDateId,
      timezone: purchase.timezone,
      paymentStatus,
      ticketCount: tickets.length,
      ticketCountValid: tickets.filter((ticket) => ticket.status === "valid").length,
      tickets,
      publicBuyerUrl: null,
      ticketPdfPath: null,
      venue: {
        locationText: purchase.locationText,
        locationGeoLat: null,
        locationGeoLng: null,
        isOnline: purchase.isOnline,
        onlineUrl: purchase.onlineUrl,
      },
      shared: true,
    }];
  });
}

/** Shared, still-going RSVPs as Calendar RSVP rows. */
export function sharedCalendarRsvps(
  purchases: readonly SharedPurchase[],
): ConsumerRsvpRow[] {
  return purchases.flatMap((purchase): ConsumerRsvpRow[] => {
    if (purchase.kind !== "rsvp" && purchase.kind !== "rsvp_guest") return [];
    if (purchase.rsvpStatus && INACTIVE_RSVP.has(purchase.rsvpStatus)) return [];
    return [{
      rsvpId: purchase.rsvpId ?? purchase.sourceId,
      guestId: purchase.kind === "rsvp_guest" ? purchase.sourceId : null,
      role: purchase.kind === "rsvp_guest" ? "guest" : "primary",
      qrCode: purchase.qrCode,
      status: purchase.rsvpStatus ?? "going",
      approvalStatus: purchase.approvalStatus ?? "approved",
      plusGuestNames: [],
      displayName: null,
      coverMediaUrl: purchase.coverMediaUrl,
      coverMediaType: purchase.coverMediaType,
      eventId: purchase.eventId ?? "",
      eventTitle: purchase.title,
      eventSlug: purchase.eventSlug ?? "",
      brandId: purchase.brand?.id ?? "",
      brandSlug: purchase.brand?.slug ?? "",
      brandName: purchase.brand?.name ?? "",
      masterDateUtc: purchase.startsAt,
      masterDateEndUtc: purchase.endsAt,
      timezone: purchase.timezone,
      venue: {
        locationText: purchase.locationText,
        isOnline: purchase.isOnline,
        onlineUrl: purchase.onlineUrl,
      },
      invitedBy: null,
      shared: true,
    }];
  });
}

/** Shared reservations as Calendar reservation rows (no fee, no refund). */
export function sharedCalendarReservations(
  purchases: readonly SharedPurchase[],
): MyReservationRow[] {
  return purchases.flatMap((purchase): MyReservationRow[] => {
    if (purchase.kind !== "reservation" || !purchase.startsAt) return [];
    return [{
      id: purchase.reservationId ?? purchase.sourceId,
      // The payload carries a venue id, not a brand id: never pass one off as
      // the other (Message brand would look up the wrong thing). Empty = none.
      brand_id: "",
      brand_slug: null,
      brand_name: purchase.venueName ?? purchase.title,
      brand_cover_url: null,
      brand_cover_type: null,
      brand_photo_url: null,
      brand_cover_hue: null,
      brand_address: null,
      brand_city: null,
      brand_lat: null,
      brand_lng: null,
      reserved_for: purchase.startsAt,
      party_size: purchase.partySize,
      status: purchase.status ?? "confirmed",
      fee_cents: null,
      fee_currency: null,
      payment_status: "",
      occasion: null,
      guest_notes: null,
      created_at: purchase.createdAt ?? purchase.startsAt,
      refund: null,
      shared: true,
    }];
  });
}

/**
 * Calendar must never lose the owner's own rows because the shared read
 * failed, so the calendar fetchers read through this and get [] on error.
 */
export async function fetchMySharedPurchasesSafely(): Promise<SharedPurchase[]> {
  try {
    return await fetchMySharedPurchases();
  } catch (error) {
    console.warn("[#4473] shared purchases unavailable", error);
    return [];
  }
}

/**
 * The event's group chat, if this account can see it (a shared purchase joins
 * the chat on claim). Same lookup the owner's order read uses.
 */
export async function fetchEventConversationId(
  eventId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, event_id")
    .eq("event_id", eventId)
    .in("linked_entity_type", ["trip", "event"])
    .eq("is_enabled", true)
    .limit(1);
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : null;
  return row && typeof row.id === "string" ? row.id : null;
}
