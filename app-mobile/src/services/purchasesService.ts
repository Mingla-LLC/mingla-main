import { calendarDayWindowsForOrder } from "./calendarOrderDays";
import { CalendarService, type ConsumerRsvpRow } from "./calendarService";
import { supabase } from "./supabase";
import type {
  PurchaseOrderSource,
  PurchaseRsvpSource,
} from "../utils/purchaseTimeline";

export interface PurchaseTicket {
  id: string;
  ticketTypeId: string;
  ticketTypeName: string | null;
  qrCode: string;
  status: string;
  attendeeName: string | null;
  attendeeEmail: string | null;
  eventDateIds: string[];
}

export interface PurchaseLineItem {
  id: string;
  quantity: number;
  unitPriceCents: number;
  listUnitPriceCents: number | null;
  discountCents: number;
  totalCents: number;
  ticketTypeName: string | null;
}

export interface PurchaseOrderRecord extends PurchaseOrderSource {
  eventDateId: string | null;
  brandId: string | null;
  conversationId: string | null;
  createdAt: string;
  ticketPdfPath: string | null;
  listSubtotalCents: number;
  discountCents: number;
  buyerFeesCents: number;
  taxCents: number;
  totalCents: number;
  paymentCardBrand: string | null;
  paymentCardLast4: string | null;
  paymentWallet: string | null;
  pricingBreakdown: Record<string, unknown> | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  locationText: string | null;
  city: string | null;
  locationGeo: unknown;
  isOnline: boolean;
  onlineUrl: string | null;
  tickets: PurchaseTicket[];
  lineItems: PurchaseLineItem[];
}

interface RawOrder {
  id: string;
  event_id: string;
  payment_status: string;
  created_at: string;
  ticket_pdf_path: string | null;
  event_date_id: string | null;
  booked_start_at: string | null;
  list_subtotal_cents: number | null;
  discount_cents: number | null;
  buyer_fees_cents: number | null;
  tax_cents: number | null;
  buyer_total_cents: number | null;
  total_cents: number | null;
  currency: string | null;
  source: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  refunded_amount_cents: number | null;
  pricing_breakdown: Record<string, unknown> | null;
  payment_card_brand: string | null;
  payment_card_last4: string | null;
  payment_wallet: string | null;
  events: {
    id: string;
    title: string;
    event_type: string | null;
    cover_media_url: string | null;
    timezone: string | null;
    location_text: string | null;
    city: string | null;
    location_geo: unknown;
    is_online: boolean | null;
    online_url: string | null;
    brand: { id: string; name: string | null } | null;
    event_dates: Array<{
      id: string;
      start_at: string | null;
      end_at: string | null;
      is_master: boolean;
    }> | null;
  } | null;
  tickets: Array<{
    id: string;
    ticket_type_id: string;
    qr_code: string;
    status: string;
    attendee_name: string | null;
    attendee_email: string | null;
    ticket_type: { name: string | null } | null;
    ticket_event_dates: Array<{ event_date_id: string }> | null;
  }> | null;
  order_line_items: Array<{
    id: string;
    quantity: number;
    unit_price_cents: number;
    list_unit_price_cents: number | null;
    discount_cents: number | null;
    total_cents: number;
    ticket_type: { name: string | null } | null;
  }> | null;
}

function money(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * #4063 — canonical consumer order read. Calendar's narrower query remains
 * unchanged because it intentionally hides refunded/cancelled rows.
 */
export async function fetchMyOrders(
  userId: string,
): Promise<PurchaseOrderRecord[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
      id, event_id, payment_status, created_at, ticket_pdf_path,
      event_date_id, booked_start_at, list_subtotal_cents, discount_cents,
      buyer_fees_cents, tax_cents, buyer_total_cents, total_cents, currency,
      source, cancelled_at, cancelled_by, refunded_amount_cents, pricing_breakdown,
      payment_card_brand, payment_card_last4, payment_wallet,
      events!inner (
        id, title, event_type, cover_media_url, timezone, location_text,
        city, location_geo, is_online, online_url,
        brand:brands!inner ( id, name ),
        event_dates!left ( id, start_at, end_at, is_master )
      ),
      tickets:tickets (
        id, ticket_type_id, qr_code, status, attendee_name, attendee_email,
        ticket_type:ticket_types ( name ),
        ticket_event_dates ( event_date_id )
      ),
      order_line_items:order_line_items (
        id, quantity, unit_price_cents, list_unit_price_cents,
        discount_cents, total_cents, ticket_type:ticket_types ( name )
      )
    `,
    )
    .eq("buyer_user_id", userId)
    .in("payment_status", [
      "paid",
      "pending",
      "partial_refund",
      "refunded",
      "cancelled",
    ])
    .order("created_at", { ascending: false });

  if (error) throw error;

  const orders = (data ?? []) as unknown as RawOrder[];
  const eventIds = [...new Set(orders.map((order) => order.event_id))];
  const conversationByEvent = new Map<string, string>();
  if (eventIds.length > 0) {
    const { data: conversations } = await supabase
      .from("conversations")
      .select("id, event_id")
      .in("event_id", eventIds)
      .in("linked_entity_type", ["trip", "event"])
      .eq("is_enabled", true);
    for (const conversation of conversations ?? []) {
      if (
        conversation.event_id &&
        !conversationByEvent.has(conversation.event_id)
      ) {
        conversationByEvent.set(conversation.event_id, conversation.id);
      }
    }
  }

  return orders.flatMap((order) => {
    const event = order.events;
    if (!event) return [];
    const bookedOccurrence = order.event_date_id
      ? (event.event_dates ?? []).find(
          (date) => date.id === order.event_date_id,
        )
      : undefined;
    const masterOccurrence =
      bookedOccurrence ??
      (event.event_dates ?? []).find((date) => date.is_master === true);
    const windows = calendarDayWindowsForOrder({
      occurrences: event.event_dates ?? null,
      tickets: order.tickets ?? null,
      fallback: {
        masterDateUtc: masterOccurrence?.start_at ?? null,
        masterDateEndUtc: masterOccurrence?.end_at ?? null,
      },
    });
    const tickets: PurchaseTicket[] = (order.tickets ?? []).map((ticket) => ({
      id: ticket.id,
      ticketTypeId: ticket.ticket_type_id,
      ticketTypeName: ticket.ticket_type?.name ?? null,
      qrCode: ticket.qr_code,
      status: ticket.status,
      attendeeName: ticket.attendee_name,
      attendeeEmail: ticket.attendee_email,
      eventDateIds: (ticket.ticket_event_dates ?? []).map(
        (link) => link.event_date_id,
      ),
    }));
    const lineItems: PurchaseLineItem[] = (order.order_line_items ?? []).map(
      (line) => ({
        id: line.id,
        quantity: line.quantity,
        unitPriceCents: line.unit_price_cents,
        listUnitPriceCents: line.list_unit_price_cents,
        discountCents: money(line.discount_cents),
        totalCents: line.total_cents,
        ticketTypeName: line.ticket_type?.name ?? null,
      }),
    );
    return windows.map((window): PurchaseOrderRecord => {
      const windowTickets = window.eventDateId
        ? tickets.filter(
            (ticket) =>
              ticket.eventDateIds.length === 0 ||
              ticket.eventDateIds.includes(window.eventDateId as string),
          )
        : tickets;
      const startAt =
        event.event_type === "experience" && order.booked_start_at
          ? order.booked_start_at
          : window.masterDateUtc;
      const buyerTotalCents = money(
        order.buyer_total_cents ?? order.total_cents,
      );
      const normalized = {
        id: order.id,
        eventDateId: window.eventDateId ?? null,
        eventId: event.id,
        eventTitle: event.title,
        eventType: event.event_type,
        brandName: event.brand?.name ?? "",
        brandId: event.brand?.id ?? null,
        conversationId: conversationByEvent.get(event.id) ?? null,
        coverMediaUrl: event.cover_media_url,
        startAt,
        endAt: window.masterDateEndUtc,
        timezone: event.timezone ?? "UTC",
        venueLine: event.location_text,
        paymentStatus: order.payment_status,
        ticketCount: windowTickets.length,
        validTicketCount: windowTickets.filter(
          (ticket) => ticket.status === "valid",
        ).length,
        source: order.source,
        currency: order.currency ?? "USD",
        buyerTotalCents,
        refundedAmountCents: money(order.refunded_amount_cents),
        createdAt: order.created_at,
        ticketPdfPath: order.ticket_pdf_path,
        listSubtotalCents: money(
          order.list_subtotal_cents ?? order.total_cents,
        ),
        discountCents: money(order.discount_cents),
        buyerFeesCents: money(order.buyer_fees_cents),
        taxCents: money(order.tax_cents),
        totalCents: money(order.total_cents),
        paymentCardBrand: order.payment_card_brand,
        paymentCardLast4: order.payment_card_last4,
        paymentWallet: order.payment_wallet,
        pricingBreakdown: order.pricing_breakdown,
        cancelledAt: order.cancelled_at,
        cancelledBy: order.cancelled_by,
        locationText: event.location_text,
        city: event.city,
        locationGeo: event.location_geo,
        isOnline: Boolean(event.is_online),
        onlineUrl: event.online_url,
        tickets: windowTickets,
        lineItems,
      };
      return { ...normalized, raw: normalized };
    });
  });
}

function mapRsvp(row: ConsumerRsvpRow): PurchaseRsvpSource {
  return {
    id: row.guestId ?? row.rsvpId,
    eventId: row.eventId,
    eventTitle: row.eventTitle,
    brandName: row.brandName,
    coverMediaUrl: row.coverMediaUrl,
    startAt: row.masterDateUtc,
    endAt: row.masterDateEndUtc,
    timezone: row.timezone,
    venueLine: row.venue.locationText,
    status: row.status,
    approvalStatus: row.approvalStatus,
    guestCount: Math.max(1, row.plusGuestNames.length + 1),
    raw: row,
  };
}

export async function fetchMyRsvps(
  userId: string,
): Promise<PurchaseRsvpSource[]> {
  const rows = await CalendarService.fetchUserGoingRsvps(userId);
  return rows.map(mapRsvp);
}

/**
 * No buyer SELECT policy exists on venue_orders today, so food receipts are
 * deliberately omitted from v1 instead of weakening RLS or fabricating data.
 */
export async function fetchMyVenueOrders(): Promise<[]> {
  return [];
}
