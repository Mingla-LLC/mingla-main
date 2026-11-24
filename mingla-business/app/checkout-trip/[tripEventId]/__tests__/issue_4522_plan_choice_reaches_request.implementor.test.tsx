/**
 * issue #4522 W-4 / S-1 — the plan choice a buyer sees is the choice the
 * server is asked for, end to end.
 *
 * Earlier suites passed while the screen was broken because they read source
 * text or rendered the plan component with a hand-built trip that already had
 * `paymentPlan`. Nothing ran the loader checkout really uses
 * (`getPublicTripById`) or the request bodies the quote and the create really
 * send. This suite drives, with only the network faked:
 *   database rows → REAL `getPublicTripById` → REAL cart (`CartProvider`)
 *   → REAL `quoteTicketCheckout` body → REAL `createTicketCheckout` body.
 *
 * Fails without the fixes:
 *   S-1a the by-id loader returns `paymentPlan: undefined` for a v2 package
 *        (checkout never offers "How you pay");
 *   S-1b the checkout seed turns a v2 package's "installments" into "full";
 *   W-4  choosing "Pay over time" on a package changes only the line, so the
 *        quote still asks for "full" and the screen shows the full price as
 *        due today while the create opens an installment session.
 */
import React from "react";

type Row = Record<string, unknown>;
const TABLES: Record<string, Row[]> = {};
const invokeBodies: Array<{ name: string; body: Record<string, unknown> }> = [];

/** A thenable query builder: every filter returns itself; await = rows. */
const builder = (table: string) => {
  const rows = (): Row[] => TABLES[table] ?? [];
  const self: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "neq",
    "in",
    "is",
    "not",
    "gt",
    "gte",
    "lt",
    "lte",
    "order",
    "limit",
    "range",
    "or",
    "filter",
  ]) {
    self[method] = () => self;
  }
  self.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
  self.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
  self.then = (resolve: (value: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
  return self;
};

let nextQuote: Record<string, unknown> = {};

jest.mock("../../../../src/services/supabase", () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: () => Promise.resolve({ data: [], error: null }),
    functions: {
      invoke: (name: string, options: { body: Record<string, unknown> }) => {
        invokeBodies.push({ name, body: options.body });
        return Promise.resolve({
          data:
            options.body.mode === "quote"
              ? nextQuote
              : { checkoutSessionId: "session-1", hostedCheckoutUrl: "https://example.test/pay" },
          error: null,
        });
      },
    },
  },
}));
jest.mock("../../../../src/analytics/webAnalytics", () => ({
  fireAdInitiateCheckout: () => undefined,
  getStoredAdMatchData: () => ({ fbp: null, fbc: null, scid: null, ttp: null }),
  getStoredClickAttribution: () => ({ clickId: null }),
  identifyAdBuyer: () => Promise.resolve(),
}));
jest.mock("../../../../src/services/referralAttribution", () => ({
  getStoredReferralVisitorKey: () => null,
}));

// eslint-disable-next-line import/first
import { getPublicTripById } from "../../../../src/services/publicEventsService";
// eslint-disable-next-line import/first
import {
  CartProvider,
  type CartContextValue,
  useCart,
} from "../../../../src/components/checkout/CartContext";
// eslint-disable-next-line import/first
import { quoteTicketCheckout } from "../../../../src/services/ticketQuoteService";
// eslint-disable-next-line import/first
import { createTicketCheckout } from "../../../../src/services/ticketCheckoutService";
// eslint-disable-next-line import/first
import { tierOffersPlan } from "../../../../src/components/trip/tripCartPlanChoice";

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => { unmount: () => void };
  act: (callback: () => void | Promise<void>) => Promise<void> | void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENT = "c2452000-0000-4000-8000-0000000000aa";
const BRAND = "c2452000-0000-4000-8000-000000000001";
const V2_TT = "c2452000-0000-4000-8000-0000000000b2";
const V1_TT = "c2452000-0000-4000-8000-0000000000b3";
const V2_PLAN = {
  v: 2,
  deposit: { mode: "amount", amount_minor: 30000 },
  count: 3,
  final_due_days_before_start: 30,
  auto_adjust: true,
  flex: { enabled: false },
};
const V1_PLAN = {
  deposit_pct: 25,
  installments: [
    { ordinal: 1, pct: 50, days_after_booking: 30 },
    { ordinal: 2, pct: 25, days_after_booking: 60 },
  ],
};

const seedRows = (): void => {
  TABLES.events = [
    {
      id: EVENT,
      brand_id: BRAND,
      title: "Lisbon week",
      description: "A week in Lisbon.",
      slug: "lisbon-week",
      status: "scheduled",
      visibility: "public",
      timezone: "America/New_York",
      theme: { business_trip: {} },
      currency: "USD",
      event_type: "trip",
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
      refund_policy: null,
      booking_deadline: null,
      bookings_closed: false,
    },
  ];
  TABLES.brands = [{ id: BRAND, slug: "trips", name: "Trips", description: null, cover_media_url: null }];
  TABLES.trip_days = [];
  TABLES.trip_inclusions = [];
  TABLES.event_dates = [
    { event_id: EVENT, start_at: "2027-03-12T00:00:00+00:00", end_at: "2027-03-16T00:00:00+00:00", is_master: true },
  ];
  TABLES.ticket_types = [
    { id: V2_TT, event_id: EVENT, name: "Standard", price_cents: 120000, currency: "USD", quantity_total: 12, is_unlimited: false, display_order: 0, created_at: "2026-11-01T00:00:00Z" },
    { id: V1_TT, event_id: EVENT, name: "Old plan", price_cents: 80000, currency: "USD", quantity_total: 12, is_unlimited: false, display_order: 1, created_at: "2026-11-01T00:00:01Z" },
  ];
  TABLES.trip_pricing_tiers = [
    { id: "tier-v2", event_id: EVENT, ticket_type_id: V2_TT, tier_name: "Standard", tier_metadata: { payment_plan: V2_PLAN } },
    { id: "tier-v1", event_id: EVENT, ticket_type_id: V1_TT, tier_name: "Old plan", tier_metadata: { installments: V1_PLAN } },
  ];
};

const BUYER = {
  name: "Sam Tester",
  email: "sam@example.test",
  phone: "+15555550143",
  marketingOptIn: true,
  termsAccepted: true,
};

let cart: CartContextValue | null = null;
const Probe = (): null => {
  cart = useCart();
  return null;
};

const quoteBody = async (current: CartContextValue): Promise<Record<string, unknown>> => {
  invokeBodies.length = 0;
  // The same input TicketQuoteController builds from the cart.
  await quoteTicketCheckout({
    eventId: EVENT,
    surface: "web",
    buyer: current.buyer.name.length > 0 ? current.buyer : { ...current.buyer, ...BUYER },
    lines: current.lines,
    paymentPlanChoice: current.paymentPlanChoice,
  });
  return invokeBodies[0]!.body;
};

beforeEach(() => {
  seedRows();
  invokeBodies.length = 0;
  nextQuote = {
    kind: "quote",
    currency: "USD",
    lines: [],
    buyerTotalCents: 30000,
    dueTodayNetCents: 30000,
    netSubtotalCents: 120000,
    quoteDigest: "0123456789abcdef0123456789abcdef",
  };
});

describe("#4522 W-4 / S-1 — the plan choice reaches the request", () => {
  test("S-1a: the checkout loader (by id) returns the v2 plan, same decoder as /t", async () => {
    const detail = await getPublicTripById(EVENT);
    const tiers = detail!.trip.pricingTiers;
    const v2 = tiers.find((tier) => tier.ticketTypeId === V2_TT)!;
    const v1 = tiers.find((tier) => tier.ticketTypeId === V1_TT)!;
    expect(v2.paymentPlan).toEqual(V2_PLAN);
    expect(v2.installmentSchedule).toBeNull();
    expect(v1.installmentSchedule).toEqual(V1_PLAN);
    expect(v1.paymentPlan ?? null).toBeNull();
    // S-1b: the seed keeps "installments" on both kinds of plan package.
    expect(tierOffersPlan(v2)).toBe(true);
    expect(tierOffersPlan(v1)).toBe(true);
    expect(tierOffersPlan({ installmentSchedule: null, paymentPlan: null })).toBe(false);
  });

  test("W-4 + S-1: a line's 'Pay over time' is the quote's choice and the create's line choice", async () => {
    const detail = await getPublicTripById(EVENT);
    const v1 = detail!.trip.pricingTiers.find((tier) => tier.ticketTypeId === V1_TT)!;
    let tree!: { unmount: () => void };
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <CartProvider>
          <Probe />
        </CartProvider>,
      );
    });
    // Seeded as the checkout index seeds a /t selection of "Pay in full".
    await TestRenderer.act(async () => {
      cart!.setLineQuantity({
        ticketTypeId: v1.ticketTypeId,
        ticketName: v1.tierName,
        unitPrice: v1.priceCents / 100,
        currency: v1.currency,
        isFree: false,
        quantity: 1,
        paymentPlanChoice: "full",
      });
      cart!.setBuyer(BUYER);
    });
    expect((await quoteBody(cart!)).payment_plan_choice).toBe("full");

    // Review & pay: the package's own "Pay over time" (the web plan control).
    await TestRenderer.act(async () => {
      cart!.setLinePaymentPlanChoice(v1.ticketTypeId, "installments");
    });
    expect(cart!.paymentPlanChoice).toBe("installments");
    const quoted = await quoteBody(cart!);
    expect(quoted.payment_plan_choice).toBe("installments");

    invokeBodies.length = 0;
    await createTicketCheckout({
      eventId: EVENT,
      buyer: cart!.buyer,
      lines: cart!.lines,
      quoteDigest: "0123456789abcdef0123456789abcdef",
      surface: "web",
      checkoutContractVersion: 2,
      checkoutAttemptId: "0b3f6b52-1f4a-4b1c-8f3d-2a6d1c9e7a10",
    });
    const created = invokeBodies.find((entry) => entry.name === "ticket-checkout-create")!.body;
    expect(created.lines).toEqual([
      expect.objectContaining({ ticketTypeId: V1_TT, paymentPlanChoice: "installments" }),
    ]);

    // Back to "Pay in full": both sides follow.
    await TestRenderer.act(async () => {
      cart!.setLinePaymentPlanChoice(v1.ticketTypeId, "full");
    });
    expect((await quoteBody(cart!)).payment_plan_choice).toBe("full");
    await TestRenderer.act(async () => tree.unmount());
  });
});
