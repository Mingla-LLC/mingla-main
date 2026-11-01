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
  ticketIndex: number;
  transferState: "none" | "offered" | "claimed";
  holderFirstName: string | null;
}

export interface PurchaseTicketState {
  ticketId: string;
  ticketIndex: number;
  transferState: "none" | "offered" | "claimed";
  holderFirstName: string | null;
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
  brandSlug?: string | null;
  eventSlug?: string | null;
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
  ticketStates: PurchaseTicketState[];
  sentByFirstName: string | null;
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
    slug: string;
    title: string;
    event_type: string | null;
    cover_media_url: string | null;
    cover_media_type: string | null;
    timezone: string | null;
    location_text: string | null;
    city: string | null;
    location_geo: unknown;
    is_online: boolean | null;
    online_url: string | null;
    brand: { id: string; slug: string; name: string | null } | null;
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
    transfer_state: "none" | "offered" | "claimed";
    holder_name: string | null;
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
        id, slug, title, event_type, cover_media_url, cover_media_type,
        timezone, location_text,
        city, location_geo, is_online, online_url,
        brand:brands!inner ( id, slug, name ),
        event_dates!left ( id, start_at, end_at, is_master )
      ),
      tickets:tickets (
        id, ticket_type_id, qr_code, status, attendee_name, attendee_email,
        transfer_state, holder_name,
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
  const ticketStatesByOrder = new Map<string, PurchaseTicketState[]>();
  await Promise.all(
    orders.map(async (order) => {
      const { data: states, error: statesError } = await supabase.rpc(
        "pg_my_order_ticket_states",
        { p_order_id: order.id },
      );
      if (statesError) throw statesError;
      ticketStatesByOrder.set(
        order.id,
        (states ?? []).map((row: {
          ticket_id: string;
          ticket_index: number;
          transfer_state: "none" | "offered" | "claimed";
          holder_first_name: string | null;
        }) => ({
          ticketId: row.ticket_id,
          ticketIndex: row.ticket_index,
          transferState: row.transfer_state,
          holderFirstName: row.holder_first_name,
        })),
      );
    }),
  );
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
    const ticketStates = ticketStatesByOrder.get(order.id) ?? [];
    const stateByTicket = new Map(
      ticketStates.map((state) => [state.ticketId, state]),
    );
    const tickets: PurchaseTicket[] = (order.tickets ?? []).map(
      (ticket, index) => ({
        id: ticket.id,
        ticketTypeId: ticket.ticket_type_id,
        ticketTypeName: ticket.ticket_type?.name ?? null,
        qrCode: ticket.qr_code,
        status: ticket.status,
        attendeeName: ticket.attendee_name,
        attendeeEmail: ticket.attendee_email,
        ticketIndex: stateByTicket.get(ticket.id)?.ticketIndex ?? index + 1,
        transferState: ticket.transfer_state,
        holderFirstName:
          stateByTicket.get(ticket.id)?.holderFirstName ??
          ticket.holder_name?.trim().split(/\s+/)[0] ??
          null,
        eventDateIds: (ticket.ticket_event_dates ?? []).map(
          (link) => link.event_date_id,
        ),
      }),
    );
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
      const normalized: Omit<PurchaseOrderRecord, "raw"> = {
        id: order.id,
        eventDateId: window.eventDateId ?? null,
        eventId: event.id,
        eventTitle: event.title,
        eventType: event.event_type,
        eventSlug: event.slug,
        brandName: event.brand?.name ?? "",
        brandId: event.brand?.id ?? null,
        brandSlug: event.brand?.slug ?? null,
        conversationId: conversationByEvent.get(event.id) ?? null,
        coverMediaUrl: event.cover_media_url,
        coverMediaType:
          event.cover_media_type === "image" ||
          event.cover_media_type === "video" ||
          event.cover_media_type === "gif"
            ? event.cover_media_type
            : null,
        startAt,
        endAt: window.masterDateEndUtc,
        timezone: event.timezone ?? "UTC",
        venueLine: event.location_text,
        paymentStatus: order.payment_status,
        ticketCount: ticketStates.length || windowTickets.length,
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
        ticketStates,
        sentByFirstName: null,
        lineItems,
      };
      return { ...normalized, raw: normalized };
    });
  });
}

interface RawHeldTicket {
  id: string;
  ticket_type_id: string;
  event_id: string;
  qr_code: string;
  status: string;
  attendee_name: string | null;
  attendee_email: string | null;
  holder_name: string | null;
  holder_sender_first_name: string | null;
  transfer_state: "claimed";
  created_at: string;
  ticket_type: { name: string | null } | null;
  ticket_event_dates: Array<{ event_date_id: string }> | null;
  events: RawOrder["events"];
}

/** #4063 D9 — tickets received from a friend are owned independently of the order. */
export async function fetchMyHeldTickets(
  userId: string,
): Promise<PurchaseOrderRecord[]> {
  const { data, error } = await supabase
    .from("tickets")
    .select(
      `
      id, ticket_type_id, event_id, qr_code, status, attendee_name,
      attendee_email, holder_name, holder_sender_first_name, transfer_state,
      created_at,
      ticket_type:ticket_types ( name ),
      ticket_event_dates ( event_date_id ),
      events!inner (
        id, slug, title, event_type, cover_media_url, cover_media_type,
        timezone, location_text,
        city, location_geo, is_online, online_url,
        brand:brands!inner ( id, slug, name ),
        event_dates!left ( id, start_at, end_at, is_master )
      )
    `,
    )
    .eq("holder_user_id", userId)
    .eq("transfer_state", "claimed")
    .order("created_at", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as unknown as RawHeldTicket[]).flatMap((row) => {
    const event = row.events;
    if (!event) return [];
    const linkedIds = new Set(
      (row.ticket_event_dates ?? []).map((link) => link.event_date_id),
    );
    const dates = (event.event_dates ?? []).filter((date) =>
      linkedIds.size === 0 ? date.is_master : linkedIds.has(date.id),
    );
    const start =
      dates[0] ?? (event.event_dates ?? []).find((date) => date.is_master);
    const ticket: PurchaseTicket = {
      id: row.id,
      ticketTypeId: row.ticket_type_id,
      ticketTypeName: row.ticket_type?.name ?? null,
      qrCode: row.qr_code,
      status: row.status,
      attendeeName: row.holder_name ?? row.attendee_name,
      attendeeEmail: row.attendee_email,
      eventDateIds: [...linkedIds],
      ticketIndex: 1,
      transferState: "claimed",
      holderFirstName: row.holder_name?.trim().split(/\s+/)[0] ?? null,
    };
    const state: PurchaseTicketState = {
      ticketId: row.id,
      ticketIndex: 1,
      transferState: "claimed",
      holderFirstName: ticket.holderFirstName,
    };
    const normalized: Omit<PurchaseOrderRecord, "raw"> = {
      id: row.id,
      eventDateId: start?.id ?? null,
      eventId: event.id,
      eventTitle: event.title,
      eventType: event.event_type,
      eventSlug: event.slug,
      brandName: event.brand?.name ?? "",
      brandId: event.brand?.id ?? null,
      brandSlug: event.brand?.slug ?? null,
      conversationId: null,
      coverMediaUrl: event.cover_media_url,
      coverMediaType:
        event.cover_media_type === "image" ||
        event.cover_media_type === "video" ||
        event.cover_media_type === "gif"
          ? event.cover_media_type
          : null,
      startAt: start?.start_at ?? row.created_at,
      endAt: start?.end_at ?? null,
      timezone: event.timezone ?? "UTC",
      venueLine: event.location_text,
      paymentStatus: "paid",
      ticketCount: 1,
      validTicketCount: row.status === "valid" ? 1 : 0,
      source: "transfer",
      currency: "USD",
      buyerTotalCents: 0,
      refundedAmountCents: 0,
      createdAt: row.created_at,
      ticketPdfPath: null,
      listSubtotalCents: 0,
      discountCents: 0,
      buyerFeesCents: 0,
      taxCents: 0,
      totalCents: 0,
      paymentCardBrand: null,
      paymentCardLast4: null,
      paymentWallet: null,
      pricingBreakdown: null,
      cancelledAt: null,
      cancelledBy: null,
      locationText: event.location_text,
      city: event.city,
      locationGeo: event.location_geo,
      isOnline: Boolean(event.is_online),
      onlineUrl: event.online_url,
      tickets: [ticket],
      ticketStates: [state],
      sentByFirstName: row.holder_sender_first_name,
      lineItems: [],
    };
    return [{ ...normalized, raw: normalized }];
  });
}

export class TicketTransferError extends Error {
  constructor(readonly code: "self" | "invalid" | "too_late" | "unavailable") {
    super(code);
  }
}

export async function offerTicketToFriend(input: {
  ticketId: string;
  name: string;
  email: string;
  phoneE164: string;
}): Promise<void> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phoneE164.trim();
  const { data, error } = await supabase.rpc("pg_ticket_offer_to_friend", {
    p_ticket_id: input.ticketId,
    p_name: name,
    p_email: email,
    p_phone_e164: phone,
  });
  if (error) {
    if (error.message.includes("ticket_offer_self"))
      throw new TicketTransferError("self");
    if (error.message.includes("ticket_offer_invalid"))
      throw new TicketTransferError("invalid");
    throw new TicketTransferError("unavailable");
  }
  if (!data?.ok) throw new TicketTransferError("unavailable");
}

export async function takeBackTicket(ticketId: string): Promise<void> {
  const { data, error } = await supabase.rpc("pg_ticket_take_back", {
    p_ticket_id: ticketId,
  });
  if (error) throw new TicketTransferError("unavailable");
  if (data?.error === "too_late") throw new TicketTransferError("too_late");
  if (!data?.ok) throw new TicketTransferError("unavailable");
}

function mapRsvp(row: ConsumerRsvpRow): PurchaseRsvpSource {
  return {
    id: row.guestId ?? row.rsvpId,
    eventId: row.eventId,
    eventTitle: row.eventTitle,
    brandName: row.brandName,
    coverMediaUrl: row.coverMediaUrl,
    coverMediaType: row.coverMediaType,
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
