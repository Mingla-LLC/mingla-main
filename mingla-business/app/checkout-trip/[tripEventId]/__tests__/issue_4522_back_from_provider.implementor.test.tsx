/**
 * issue #4522 E-2 / E-3 — the buyer presses the browser's Back button on the
 * provider page and lands on Review & pay again.
 *
 * That Back is a full reload: the in-memory cart is rebuilt from the resume
 * payload. Before the fix the lines came back on "Pay over time" while the
 * quoted (cart-level) choice was "full" — total, banner and Pay button said
 * the full price while the provider charged the deposit (E-2) — and the
 * attempt id and provider page were gone, so Pay opened a SECOND payable
 * session for the same cart (E-3).
 *
 * Driven with only the network faked: REAL `CartProvider` → the Pay path's
 * REAL resume payload in a REAL storage → a NEW `CartProvider` (the reload)
 * → REAL `restoreTripCheckout` → REAL quote body and REAL create body, then
 * the Pay decision for the held checkout.
 *
 * Earlier suites never crossed the reload: they drove one cart instance, where
 * the choice and the attempt are still in memory.
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
import {
  readCheckoutResumePayload,
  writeCheckoutResumePayload,
} from "../../../../src/components/checkout/checkoutPersistence";
// eslint-disable-next-line import/first
import {
  restoreTripCheckout,
  tripResumeDecision,
} from "../../../../src/components/checkout/tripCheckoutResume";

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


const memoryStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    get length(): number { return map.size; },
    clear: (): void => map.clear(),
    getItem: (key: string): string | null => map.get(key) ?? null,
    key: (index: number): string | null => [...map.keys()][index] ?? null,
    removeItem: (key: string): void => { map.delete(key); },
    setItem: (key: string, value: string): void => { map.set(key, value); },
  };
};

const mountCart = async (): Promise<{ unmount: () => void }> => {
  let tree!: { unmount: () => void };
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
  });
  return tree;
};

const createBody = async (current: CartContextValue): Promise<Record<string, unknown>> => {
  invokeBodies.length = 0;
  await createTicketCheckout({
    eventId: EVENT,
    buyer: current.buyer,
    lines: current.lines,
    quoteDigest: "0123456789abcdef0123456789abcdef",
    surface: "web",
    checkoutContractVersion: 2,
    checkoutAttemptId: current.checkoutAttemptIdFor({ eventId: EVENT, surface: "web" }),
  });
  return invokeBodies.find((entry) => entry.name === "ticket-checkout-create")!.body;
};

/** What the Review & pay screen keys its held provider page by (same fields). */
const screenFingerprint = (current: CartContextValue): string =>
  JSON.stringify({
    eventId: EVENT,
    email: current.buyer.email.trim().toLowerCase(),
    phone: current.buyer.phone.trim(),
    lines: current.lines.map((l) => [
      l.ticketTypeId, l.quantity, l.paymentPlanChoice ?? "full", l.addOns ?? null, l.addonPaymentMode ?? null,
    ]),
    intakeFormData: [],
  });

const PROVIDER_PAGE = "https://checkout.stripe.com/c/pay/cs_test_first";

/** Review & pay on "Pay over time", Pay pressed: returns what was sent and saved. */
const payOverTime = async (
  storage: Storage,
  ticketTypeId: string,
  extra: { addOns?: Array<{ addOnId: string; quantity: number }>; addonPaymentMode?: "today" | "spread" } = {},
): Promise<{ attemptId: unknown; fingerprint: string }> => {
  const detail = await getPublicTripById(EVENT);
  const tier = detail!.trip.pricingTiers.find((t) => t.ticketTypeId === ticketTypeId)!;
  await TestRenderer.act(async () => {
    cart!.setLineQuantity({
      ticketTypeId,
      ticketName: tier.tierName,
      unitPrice: tier.priceCents / 100,
      currency: tier.currency,
      isFree: false,
      quantity: 1,
      paymentPlanChoice: "full",
      ...extra,
    });
    cart!.setBuyer(BUYER);
  });
  await TestRenderer.act(async () => {
    cart!.setLinePaymentPlanChoice(ticketTypeId, "installments");
  });
  expect((await quoteBody(cart!)).payment_plan_choice).toBe("installments");
  const created = await createBody(cart!);
  const fingerprint = screenFingerprint(cart!);
  // The Pay path's resume payload, written before the redirect.
  const sent = cart!.heldCheckoutAttempt();
  writeCheckoutResumePayload(storage, EVENT, {
    checkoutSessionId: "session-1",
    buyerStatusToken: "token-1",
    lines: cart!.lines,
    buyer: cart!.buyer,
    providerHandoff: { fingerprint, redirectUrl: PROVIDER_PAGE, totalCents: 20000, currency: "USD" },
    ...(sent !== null ? { checkoutAttempt: sent } : {}),
  });
  return { attemptId: created.checkoutAttemptId, fingerprint };
};

describe("#4522 E-2 / E-3 — Back from the provider page", () => {
  test.each([
    ["old plan (v1)", V1_TT, {}],
    ["plan v2", V2_TT, {}],
    ["plan v2 + add-on spread over the plan", V2_TT, {
      addOns: [{ addOnId: "c2452000-0000-4000-8000-0000000000c1", quantity: 1 }],
      addonPaymentMode: "spread" as const,
    }],
  ])("%s: after the reload, the quote asks for the choice on screen and Pay resends the same attempt", async (_label, ticketTypeId, extra) => {
    const storage = memoryStorage();
    const first = await mountCart();
    const { attemptId, fingerprint } = await payOverTime(storage, ticketTypeId, extra);
    await TestRenderer.act(async () => first.unmount());

    // Back = reload: a brand-new cart, rebuilt from the saved payload.
    const second = await mountCart();
    expect(cart!.lines).toEqual([]);
    let resumed: ReturnType<typeof restoreTripCheckout> = null;
    await TestRenderer.act(async () => {
      resumed = restoreTripCheckout(
        readCheckoutResumePayload(storage, EVENT),
        cart!,
        cart!.lines.length === 0,
      );
    });
    // E-2 — the line AND the quoted choice are "Pay over time": one quote, one amount.
    expect(cart!.lines[0]?.paymentPlanChoice).toBe("installments");
    expect(cart!.paymentPlanChoice).toBe("installments");
    expect((await quoteBody(cart!)).payment_plan_choice).toBe("installments");
    // E-3 — the same cart is the same purchase: the held page is followed…
    expect(screenFingerprint(cart!)).toBe(fingerprint);
    await expect(
      tripResumeDecision(resumed, screenFingerprint(cart!), async () => ({ status: "requires_payment", order: null })),
    ).resolves.toEqual({ kind: "follow", url: PROVIDER_PAGE });
    // …and a create still resends the first attempt id, so the server answers
    // with the first checkout instead of opening a second payable one.
    const again = await createBody(cart!);
    expect(again.checkoutAttemptId).toBe(attemptId);
    expect(again.lines).toEqual([expect.objectContaining({ ticketTypeId, paymentPlanChoice: "installments" })]);
    await TestRenderer.act(async () => second.unmount());
  });

  test("the held checkout decides Pay: paid goes to confirmation, over is forgotten, a changed cart is a new purchase", async () => {
    const resumed = {
      checkoutSessionId: "session-1",
      buyerStatusToken: "token-1",
      fingerprint: "cart-A",
      redirectUrl: PROVIDER_PAGE,
    };
    const status = (s: string, order: unknown = null) => async () => ({ status: s, order });
    await expect(tripResumeDecision(resumed, "cart-A", status("paid_completed"))).resolves.toEqual({ kind: "confirm" });
    await expect(tripResumeDecision(resumed, "cart-A", status("requires_payment", { id: "o1" }))).resolves.toEqual({ kind: "confirm" });
    await expect(tripResumeDecision(resumed, "cart-A", status("expired"))).resolves.toEqual({ kind: "create", forget: true });
    await expect(tripResumeDecision(resumed, "cart-A", status("failed"))).resolves.toEqual({ kind: "create", forget: true });
    // a second-provider page left open reads "abandoned" at the provider, but it
    // can still be paid and cannot be closed: it is reused, never forgotten
    const abandoned = async () => ({ status: "failed", order: null, error: "paystack_charge_abandoned" });
    await expect(tripResumeDecision(resumed, "cart-A", abandoned)).resolves.toEqual({ kind: "follow", url: PROVIDER_PAGE });
    await expect(
      tripResumeDecision({ ...resumed, redirectUrl: null }, "cart-A", abandoned),
    ).resolves.toEqual({ kind: "create", forget: false });
    await expect(tripResumeDecision(resumed, "cart-B", status("requires_payment"))).resolves.toEqual({ kind: "create", forget: false });
    // no stored https page (a Paystack page from an older tab, say): the same attempt goes to the server
    await expect(
      tripResumeDecision({ ...resumed, redirectUrl: null }, "cart-A", status("awaiting_web_redirect")),
    ).resolves.toEqual({ kind: "create", forget: false });
    // no status answer: the provider page says whether it can still pay
    await expect(
      tripResumeDecision(resumed, "cart-A", async () => { throw new Error("offline"); }),
    ).resolves.toEqual({ kind: "follow", url: PROVIDER_PAGE });
    await expect(tripResumeDecision(null, "cart-A", status("requires_payment"))).resolves.toEqual({ kind: "create", forget: false });
  });

  test("only an https provider page is followed back out of storage", () => {
    const storage = memoryStorage();
    writeCheckoutResumePayload(storage, EVENT, {
      checkoutSessionId: "session-1",
      buyerStatusToken: "token-1",
      lines: [],
      buyer: BUYER,
      providerHandoff: { fingerprint: "cart-A", redirectUrl: "javascript:alert(1)", totalCents: 1, currency: "USD" },
    });
    const noop = (): void => undefined;
    const resumed = restoreTripCheckout(
      readCheckoutResumePayload(storage, EVENT),
      { setLineQuantity: noop, setLinePaymentPlanChoice: noop, setBuyer: noop, restoreCheckoutAttempt: noop },
      false,
    );
    expect(resumed?.redirectUrl).toBeNull();
    expect(resumed?.fingerprint).toBe("cart-A");
  });
});
