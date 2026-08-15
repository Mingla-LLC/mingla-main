import {
  fetchVenueOrderMetrics,
  VenueOrderMetricsRequestError,
  VenueOrderMetricsUnavailableError,
  normalizeVenueOrderMetrics,
} from "../venueOrderMetricsService";
import { supabase } from "../supabase";

const BRAND = "00000000-1795-4000-8000-000000000002";
const VENUE = "00000000-1795-4000-8000-000000000003";

const dates = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 6, 1 + index));
  return date.toISOString().slice(0, 10);
});

const validPayload = (): Record<string, unknown> => ({
  schema_version: 1,
  brand_id: BRAND,
  venue_id: VENUE,
  authorized: true,
  resolved_timezone: "Europe/London",
  tz_confidence: "iana",
  window: {
    days: 30,
    local_start_date: dates[0],
    local_end_date: dates[29],
    capture_started_at: dates[0],
    window_complete: true,
    service_days: 14,
    state: "ready",
    thin_label: null,
  },
  orders_30d: 2,
  channel_split: { qr: 1, page: 0, counter_pickup: 0, staff: 1 },
  money_state_by_currency: { GBP: "complete", USD: "partial_refund_unallocated" },
  unallocated_refunds_by_currency: { USD: { orders: 1, cents: 400 } },
  sales_cents_30d: { GBP: 2400 },
  tips_cents_30d: { GBP: 200 },
  spend_per_order: { GBP: { sales_cents: 2400, orders: 2, average_cents: 1200 } },
  spend_per_cover_tier_a: {
    GBP: {
      sales_cents: 2400,
      reservations: 1,
      sessions: 2,
      covers: 4,
      average_cents: 600,
      sample_state: "measured",
      label: "Measured on 4 covers",
    },
  },
  tier_a_currency_conflict_reservations: 0,
  attach_counts: {
    state: "counted",
    ordered_reservations: 1,
    seated_reservations: 2,
    window_complete: true,
  },
  placed_at_by_daypart: [
    { daypart: "morning", orders: 0 },
    { daypart: "afternoon", orders: 1 },
    { daypart: "evening", orders: 1 },
    { daypart: "late_night", orders: 0 },
  ],
  placed_at_by_iso_weekday: Array.from({ length: 7 }, (_, index) => ({
    iso_weekday: index + 1,
    orders: index === 1 ? 2 : 0,
  })),
  daily_30d: dates.map((localDate, index) => ({
    local_date: localDate,
    orders: index === 29 ? 2 : 0,
    sales_cents: index === 29 ? { GBP: 2400 } : {},
    tips_cents: index === 29 ? { GBP: 200 } : {},
    money_state_by_currency: { GBP: "complete", USD: "partial_refund_unallocated" },
  })),
  items_by_velocity: [
    {
      menu_item_id: "00000000-1795-4000-8000-000000000101",
      item_name_snapshot: "Burger snapshot",
      quantity: 2,
      orders: 2,
      service_days: 2,
      units_per_service_day: 1,
      by_daypart: [
        { daypart: "morning", quantity: 0 },
        { daypart: "afternoon", quantity: 1 },
        { daypart: "evening", quantity: 1 },
        { daypart: "late_night", quantity: 0 },
      ],
      sales_cents: { GBP: 2400 },
      money_state_by_currency: { GBP: "complete" },
    },
  ],
  revenue_by_zone: [
    {
      zone: "indoor",
      orders: 2,
      sessions: 2,
      current_seat_capacity: 8,
      sales_cents: { GBP: 2400 },
      sales_per_current_seat_cents: { GBP: 300 },
      money_state_by_currency: { GBP: "complete" },
    },
  ],
  revenue_by_room: [],
  data_completeness: {
    active_tables_missing_zone: 1,
    sold_items_missing_cost: 1,
    tier_a_currency_conflict_reservations: 0,
    show_zone_todo: true,
    show_item_cost_todo: true,
  },
});

describe("#1795 strict venue-order metrics normalization", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accepts the schema-v1 server truth without filling partial-refund money", () => {
    const result = normalizeVenueOrderMetrics(validPayload(), BRAND, VENUE);
    expect(result.schemaVersion).toBe(1);
    expect(result.daily30d).toHaveLength(30);
    expect(result.placedAtByIsoWeekday.map((row) => row.isoWeekday)).toEqual([1,2,3,4,5,6,7]);
    expect(result.moneyStateByCurrency.USD).toBe("partial_refund_unallocated");
    expect(result.salesCents30d.USD).toBeUndefined();
    expect(result.spendPerCoverTierA.GBP?.label).toBe("Measured on 4 covers");
  });

  it("rejects a forbidden private field anywhere in the aggregate", () => {
    const payload = validPayload();
    (payload.items_by_velocity as Record<string, unknown>[])[0].buyer_email = "leak@example.test";
    expect(() => normalizeVenueOrderMetrics(payload, BRAND, VENUE)).toThrow(
      VenueOrderMetricsUnavailableError,
    );
  });

  it("rejects fabricated zero money for a partial-refund currency", () => {
    const payload = validPayload();
    payload.sales_cents_30d = { GBP: 2400, USD: 0 };
    expect(() => normalizeVenueOrderMetrics(payload, BRAND, VENUE)).toThrow(
      VenueOrderMetricsUnavailableError,
    );
  });

  it("rejects non-zero-filled, non-consecutive and wrong-schema responses", () => {
    const short = validPayload();
    (short.daily_30d as unknown[]).pop();
    expect(() => normalizeVenueOrderMetrics(short, BRAND, VENUE)).toThrow();
    const wrong = validPayload();
    wrong.schema_version = 2;
    expect(() => normalizeVenueOrderMetrics(wrong, BRAND, VENUE)).toThrow();
  });

  it("rejects negative, nonfinite, invalid-currency, timezone and state values", () => {
    const negative = validPayload();
    negative.orders_30d = -1;
    expect(() => normalizeVenueOrderMetrics(negative, BRAND, VENUE)).toThrow();

    const nonfinite = validPayload();
    (nonfinite.items_by_velocity as Record<string, unknown>[])[0].units_per_service_day = Number.NaN;
    expect(() => normalizeVenueOrderMetrics(nonfinite, BRAND, VENUE)).toThrow();

    const currency = validPayload();
    currency.sales_cents_30d = { gbp: 2400 };
    expect(() => normalizeVenueOrderMetrics(currency, BRAND, VENUE)).toThrow();

    const timezone = validPayload();
    timezone.resolved_timezone = "Europe/Not_A_Zone";
    expect(() => normalizeVenueOrderMetrics(timezone, BRAND, VENUE)).toThrow();

    const state = validPayload();
    (state.window as Record<string, unknown>).state = "confident";
    expect(() => normalizeVenueOrderMetrics(state, BRAND, VENUE)).toThrow();
  });

  it("rejects partial-refund money in every aggregate and raw-refund mismatches", () => {
    const spend = validPayload();
    spend.spend_per_order = {
      ...(spend.spend_per_order as Record<string, unknown>),
      USD: { sales_cents: 0, orders: 1, average_cents: 0 },
    };
    expect(() => normalizeVenueOrderMetrics(spend, BRAND, VENUE)).toThrow();

    const item = validPayload();
    (item.items_by_velocity as Record<string, unknown>[])[0].sales_cents = { GBP: 2400, USD: 0 };
    expect(() => normalizeVenueOrderMetrics(item, BRAND, VENUE)).toThrow();

    const daily = validPayload();
    (daily.daily_30d as Record<string, unknown>[])[0].sales_cents = { USD: 0 };
    expect(() => normalizeVenueOrderMetrics(daily, BRAND, VENUE)).toThrow();

    const refund = validPayload();
    refund.unallocated_refunds_by_currency = {};
    expect(() => normalizeVenueOrderMetrics(refund, BRAND, VENUE)).toThrow();
  });

  it("throws honest request errors for RPC and transport failures", async () => {
    jest.spyOn(supabase, "rpc").mockResolvedValueOnce({
      data: null,
      error: { message: "denied" },
    } as never);
    await expect(fetchVenueOrderMetrics(BRAND, VENUE)).rejects.toBeInstanceOf(
      VenueOrderMetricsRequestError,
    );

    jest.spyOn(supabase, "rpc").mockRejectedValueOnce(new Error("network"));
    await expect(fetchVenueOrderMetrics(BRAND, VENUE)).rejects.toBeInstanceOf(
      VenueOrderMetricsRequestError,
    );
  });
});
