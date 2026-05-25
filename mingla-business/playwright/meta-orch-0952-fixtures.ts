import type { Page, Route } from "@playwright/test";

export type CheckoutRouteKind = "trip" | "event";
export type TicketCount = 1 | 3;

const PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const ids = {
  brand: "brand-meta-orch-0952",
  event: "test-event-id",
  trip: "test-trip-id",
  eventTicket: "ticket-type-event-general",
  tripTicket: "ticket-type-trip-general",
};

const json = (route: Route, body: unknown): Promise<void> =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  });

const makeTickets = (count: TicketCount, kind: CheckoutRouteKind) =>
  Array.from({ length: count }, (_, index) => ({
    ticketId: `${kind}-ticket-${index + 1}`,
    ticketTypeId: kind === "trip" ? ids.tripTicket : ids.eventTicket,
    ticketName: kind === "trip" ? "Traveler pass" : "General admission",
    qrPayload: `${kind.toUpperCase()}-QR-${index + 1}`,
    qrImageDataUrl: PNG_DATA_URI,
    status: "valid",
  }));

const makeOrder = (count: TicketCount, kind: CheckoutRouteKind) => ({
  orderId: `order-${kind}-${count}`,
  checkoutSessionId: "mock",
  buyerStatusToken: "mock",
  eventId: kind === "trip" ? ids.trip : ids.event,
  paymentStatus: "paid",
  totalCents: count * 2500,
  taxAmountCents: 0,
  currency: "USD",
  notificationStatus: "queued",
  tickets: makeTickets(count, kind),
});

const eventTypeRow = { event_type: "event" };

const publicEventRow = {
  id: ids.event,
  brand_id: ids.brand,
  brand_slug: "meta-orch-brand",
  brand_name: "Meta ORCH Brand",
  brand_description: null,
  brand_profile_photo_url: null,
  brand_display_attendee_count: false,
  title: "Meta ORCH Event",
  description: "Fixture event",
  slug: "meta-orch-event",
  location_text: "New York, NY",
  online_url: null,
  is_online: false,
  is_recurring: false,
  is_multi_date: false,
  recurrence_rules: null,
  cover_media_url: null,
  cover_media_type: null,
  cover_media_provider: null,
  cover_media_source_url: null,
  cover_media_credit: null,
  cover_media_credit_url: null,
  cover_media_alt: null,
  currency: "USD",
  visibility: "public",
  show_on_discover: true,
  status: "scheduled",
  published_at: "2026-05-24T12:00:00.000Z",
  timezone: "America/New_York",
  created_at: "2026-05-01T12:00:00.000Z",
  updated_at: "2026-05-24T12:00:00.000Z",
  public_theme: {
    business_event: {
      format: "in_person",
      whenMode: "single",
      location: { venueName: "Fixture Hall", address: "New York, NY" },
      settings: {},
    },
  },
  master_start_at: "2026-06-01T23:00:00.000Z",
  master_end_at: "2026-06-02T02:00:00.000Z",
  master_timezone: "America/New_York",
  master_event_date_id: "date-meta-orch-0952",
};

const tripEventRow = {
  id: ids.trip,
  brand_id: ids.brand,
  title: "Meta ORCH Trip",
  description: "Fixture trip",
  slug: "meta-orch-trip",
  status: "scheduled",
  visibility: "public",
  published_at: "2026-05-24T12:00:00.000Z",
  timezone: "America/New_York",
  cover_media_url: null,
  cover_media_type: null,
  theme: {
    business_trip: {
      startAt: "2026-06-01T13:00:00.000Z",
      endAt: "2026-06-03T20:00:00.000Z",
      destinationLocationText: "Hudson Valley",
      capacity: 24,
    },
  },
  refund_policy: null,
  booking_deadline: null,
  bookings_closed: false,
  bookings_closed_at: null,
  created_at: "2026-05-01T12:00:00.000Z",
  updated_at: "2026-05-24T12:00:00.000Z",
};

const brandRow = {
  id: ids.brand,
  slug: "meta-orch-brand",
  name: "Meta ORCH Brand",
  description: null,
  cover_media_url: null,
};

const ticketType = (kind: CheckoutRouteKind) => ({
  id: kind === "trip" ? ids.tripTicket : ids.eventTicket,
  event_id: kind === "trip" ? ids.trip : ids.event,
  name: kind === "trip" ? "Traveler pass" : "General admission",
  description: null,
  price_cents: 2500,
  currency: "USD",
  quantity_total: 100,
  is_unlimited: false,
  is_free: false,
  sale_start_at: null,
  sale_end_at: null,
  min_purchase_qty: 1,
  max_purchase_qty: 10,
  is_hidden: false,
  is_disabled: false,
  requires_approval: false,
  allow_transfers: true,
  password_protected: false,
  available_online: true,
  available_in_person: false,
  waitlist_enabled: false,
  display_order: 0,
});

export async function mockCheckoutConfirmPipeline(
  page: Page,
  options: { kind: CheckoutRouteKind; ticketCount: TicketCount },
): Promise<void> {
  await page.route("https://*.supabase.co/functions/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (
      pathname.endsWith("/ticket-checkout-confirm") ||
      pathname.endsWith("/ticket-checkout-status")
    ) {
      return json(route, {
        checkoutSessionId: "mock",
        status: "paid",
        order: makeOrder(options.ticketCount, options.kind),
      });
    }
    return json(route, {});
  });

  await page.route("https://*.supabase.co/rest/v1/**", (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/").pop() ?? "";
    const query = url.searchParams;
    const idFilter = query.get("id") ?? "";
    const wantsObject = route
      .request()
      .headers()
      .accept?.includes("application/vnd.pgrst.object+json") === true;

    if (table === "events" && query.get("select") === "event_type") {
      return json(route, eventTypeRow);
    }
    if (table === "events" && idFilter === `eq.${ids.trip}`) {
      return json(route, tripEventRow);
    }
    if (table === "business_public_events_view") {
      return json(route, publicEventRow);
    }
    if (table === "brands") {
      return json(route, brandRow);
    }
    if (table === "ticket_types") {
      const kind = idFilter === `eq.${ids.trip}` ? "trip" : "event";
      const rows = [ticketType(kind)];
      return json(route, wantsObject ? rows[0] : rows);
    }
    if (table === "trip_days" || table === "trip_pricing_tiers" || table === "trip_inclusions") {
      return json(route, []);
    }
    return json(route, wantsObject ? null : []);
  });
}

export const checkoutRoutes = {
  trip: "/checkout-trip/test-trip-id/confirm?cs=mock&csi=mock&bst=mock",
  event: "/checkout/test-event-id/confirm?cs=mock&csi=mock&bst=mock",
} as const;
