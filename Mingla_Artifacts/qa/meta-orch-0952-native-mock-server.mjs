import { createServer } from "node:http";

const port = Number(process.env.META_ORCH_0952_NATIVE_MOCK_PORT ?? 43105);
const now = "2026-05-24T12:00:00.000Z";
const ids = {
  brand: "brand-meta-orch-0952-native",
  trip: "test-trip-id",
  ticketType: "ticket-type-trip-free",
};
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const send = (res, body) => {
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
};

const tripEvent = {
  id: ids.trip,
  brand_id: ids.brand,
  title: "META-ORCH-0952 Native Trip",
  description: "Native fixture trip",
  slug: "meta-orch-0952-native-trip",
  status: "scheduled",
  visibility: "public",
  event_type: "trip",
  published_at: now,
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
  deleted_at: null,
  created_at: now,
  updated_at: now,
};

const brand = {
  id: ids.brand,
  slug: "meta-orch-0952-brand",
  name: "META ORCH Brand",
  description: null,
  cover_media_url: null,
  deleted_at: null,
};

const ticketType = {
  id: ids.ticketType,
  event_id: ids.trip,
  name: "Free traveler pass",
  description: null,
  price_cents: 0,
  currency: "USD",
  quantity_total: 100,
  is_unlimited: false,
  is_free: true,
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
  deleted_at: null,
};

const pricingTier = {
  id: "tier-meta-orch-0952-free",
  event_id: ids.trip,
  ticket_type_id: ids.ticketType,
  tier_name: "Free traveler pass",
  tier_metadata: {},
};

const order = {
  orderId: "order-meta-orch-0952-native",
  checkoutSessionId: "native-mock-session",
  buyerStatusToken: "native-mock-token",
  eventId: ids.trip,
  paymentStatus: "paid",
  totalCents: 0,
  taxAmountCents: 0,
  currency: "USD",
  notificationStatus: "queued",
  tickets: [1, 2, 3].map((index) => ({
    ticketId: `native-ticket-${index}`,
    ticketTypeId: ids.ticketType,
    ticketName: "Free traveler pass",
    qrPayload: `META-ORCH-0952-NATIVE-${index}`,
    qrImageDataUrl: png,
    status: "valid",
  })),
};

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, {});
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const table = url.pathname.split("/").pop();
  if (url.pathname.endsWith("/functions/v1/ticket-checkout-create")) {
    return send(res, {
      kind: "free_completed",
      ...order,
    });
  }
  if (table === "events") return send(res, tripEvent);
  if (table === "brands") return send(res, brand);
  if (table === "trip_days" || table === "trip_inclusions") return send(res, []);
  if (table === "trip_pricing_tiers") return send(res, [pricingTier]);
  if (table === "ticket_types") return send(res, [ticketType]);
  return send(res, []);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`META-ORCH-0952 native mock Supabase listening on ${port}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
