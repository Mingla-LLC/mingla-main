import { supabase } from "./supabase";
import { DATA_FETCH_TIMEOUT_MS, withTimeout } from "../utils/withTimeout";

export type VenueOrderMoneyState = "complete" | "partial_refund_unallocated";
export type VenueOrderWindowState = "unauthorized" | "none" | "early" | "ready";
export type VenueOrderTimezoneConfidence = "iana" | "offset" | "utc";

export interface MoneyAverage {
  salesCents: number;
  orders: number;
  averageCents: number;
}

export interface CoverAverage {
  salesCents: number;
  reservations: number;
  sessions: number;
  covers: number;
  averageCents: number | null;
  sampleState: "none" | "measured";
  label: string;
}

export interface VenueOrderMetrics {
  schemaVersion: 1;
  brandId: string;
  venueId: string;
  authorized: boolean;
  resolvedTimezone: string | null;
  timezoneConfidence: VenueOrderTimezoneConfidence | null;
  window: {
    days: 30;
    localStartDate: string | null;
    localEndDate: string | null;
    captureStartedAt: string | null;
    windowComplete: boolean;
    serviceDays: number;
    state: VenueOrderWindowState;
    thinLabel: string | null;
  };
  orders30d: number;
  channelSplit: Record<"qr" | "page" | "counter_pickup" | "staff", number>;
  moneyStateByCurrency: Record<string, VenueOrderMoneyState>;
  unallocatedRefundsByCurrency: Record<string, { orders: number; cents: number }>;
  salesCents30d: Record<string, number>;
  tipsCents30d: Record<string, number>;
  spendPerOrder: Record<string, MoneyAverage>;
  spendPerCoverTierA: Record<string, CoverAverage>;
  tierACurrencyConflictReservations: number;
  attachCounts: {
    state: "not_applicable" | "counted";
    orderedReservations: number;
    seatedReservations: number;
    windowComplete: boolean;
  };
  placedAtByDaypart: { daypart: "morning" | "afternoon" | "evening" | "late_night"; orders: number }[];
  placedAtByIsoWeekday: { isoWeekday: number; orders: number }[];
  daily30d: {
    localDate: string;
    orders: number;
    salesCents: Record<string, number>;
    tipsCents: Record<string, number>;
    moneyStateByCurrency: Record<string, VenueOrderMoneyState>;
  }[];
  itemsByVelocity: {
    menuItemId: string;
    itemNameSnapshot: string;
    quantity: number;
    orders: number;
    serviceDays: number;
    unitsPerServiceDay: number;
    byDaypart: { daypart: "morning" | "afternoon" | "evening" | "late_night"; quantity: number }[];
    salesCents: Record<string, number>;
    moneyStateByCurrency: Record<string, VenueOrderMoneyState>;
  }[];
  revenueByZone: {
    zone: string;
    orders: number;
    sessions: number;
    currentSeatCapacity: number | null;
    salesCents: Record<string, number>;
    salesPerCurrentSeatCents: Record<string, number>;
    moneyStateByCurrency: Record<string, VenueOrderMoneyState>;
  }[];
  revenueByRoom: {
    stayUnitId: string;
    spotLabelSnapshot: string;
    orders: number;
    sessions: number;
    salesCents: Record<string, number>;
    moneyStateByCurrency: Record<string, VenueOrderMoneyState>;
  }[];
  dataCompleteness: {
    activeTablesMissingZone: number;
    soldItemsMissingCost: number;
    tierACurrencyConflictReservations: number;
    showZoneTodo: boolean;
    showItemCostTodo: boolean;
  };
}

export class VenueOrderMetricsRequestError extends Error {
  constructor() {
    super("venue order metrics request failed");
    this.name = "VenueOrderMetricsRequestError";
  }
}

export class VenueOrderMetricsUnavailableError extends Error {
  constructor() {
    super("venue order metrics are unavailable");
    this.name = "VenueOrderMetricsUnavailableError";
  }
}

type JsonObject = Record<string, unknown>;
const DAYPARTS = ["morning", "afternoon", "evening", "late_night"] as const;
const MONEY_STATES = ["complete", "partial_refund_unallocated"] as const;
const FORBIDDEN_KEYS = new Set([
  "buyer_name", "buyer_email", "buyer_phone", "buyer_phone_e164", "buyer_user_id",
  "guest_name", "guest_email", "guest_phone", "guest_phone_e164", "guest_user_id",
  "staff_id", "taken_by_user_id", "acknowledged_by_user_id", "pickup_code",
  "order_id", "session_id", "reservation_id", "stripe_charge_id",
  "stripe_payment_intent_id", "paystack_reference", "provider_reference",
  "buyer_status_token", "guest_cancel_token", "notes", "created_at",
]);

const objectOrThrow = (value: unknown): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VenueOrderMetricsUnavailableError();
  }
  return value as JsonObject;
};

const arrayOrThrow = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new VenueOrderMetricsUnavailableError();
  return value;
};

const stringOrThrow = (value: unknown): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VenueOrderMetricsUnavailableError();
  }
  return value.trim();
};

const nullableStringOrThrow = (value: unknown): string | null =>
  value === null ? null : stringOrThrow(value);

const integerOrThrow = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new VenueOrderMetricsUnavailableError();
  }
  return value;
};

const finiteOrThrow = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new VenueOrderMetricsUnavailableError();
  }
  return value;
};

const booleanOrThrow = (value: unknown): boolean => {
  if (typeof value !== "boolean") throw new VenueOrderMetricsUnavailableError();
  return value;
};

const currencyOrThrow = (value: string): string => {
  if (!/^[A-Z]{3}$/.test(value)) throw new VenueOrderMetricsUnavailableError();
  return value;
};

const integerMoneyMapOrThrow = (value: unknown): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const [currency, raw] of Object.entries(objectOrThrow(value)).sort()) {
    result[currencyOrThrow(currency)] = integerOrThrow(raw);
  }
  return result;
};

const moneyStateMapOrThrow = (value: unknown): Record<string, VenueOrderMoneyState> => {
  const result: Record<string, VenueOrderMoneyState> = {};
  for (const [currency, raw] of Object.entries(objectOrThrow(value)).sort()) {
    if (typeof raw !== "string" || !MONEY_STATES.includes(raw as VenueOrderMoneyState)) {
      throw new VenueOrderMetricsUnavailableError();
    }
    result[currencyOrThrow(currency)] = raw as VenueOrderMoneyState;
  }
  return result;
};

const sameMoneyStates = (
  left: Record<string, VenueOrderMoneyState>,
  right: Record<string, VenueOrderMoneyState>,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const assertCompleteCurrencyMoney = (
  money: Record<string, number>,
  states: Record<string, VenueOrderMoneyState>,
): void => {
  for (const currency of Object.keys(money)) {
    if (states[currency] !== "complete") {
      throw new VenueOrderMetricsUnavailableError();
    }
  }
};

const isoDateOrNull = (value: unknown): string | null => {
  if (value === null) return null;
  const date = stringOrThrow(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new VenueOrderMetricsUnavailableError();
  return date;
};

const assertNoForbiddenKeys = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenKeys);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, nested] of Object.entries(value as JsonObject)) {
    if (FORBIDDEN_KEYS.has(key)) throw new VenueOrderMetricsUnavailableError();
    assertNoForbiddenKeys(nested);
  }
};

const validTimezone = (
  timezone: string,
  confidence: VenueOrderTimezoneConfidence,
): boolean => {
  if (confidence === "utc") return timezone === "UTC";
  if (confidence === "offset") return /^UTC(?:\+|-)(?:0\d|1[0-4]):[0-5]\d$/.test(timezone);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
};

const daypartsOrThrow = (
  value: unknown,
  countKey: "orders" | "quantity",
): { daypart: (typeof DAYPARTS)[number]; orders: number }[] | { daypart: (typeof DAYPARTS)[number]; quantity: number }[] => {
  const rows = arrayOrThrow(value);
  if (rows.length !== DAYPARTS.length) throw new VenueOrderMetricsUnavailableError();
  return rows.map((raw, index) => {
    const row = objectOrThrow(raw);
    if (row.daypart !== DAYPARTS[index]) throw new VenueOrderMetricsUnavailableError();
    return { daypart: DAYPARTS[index], [countKey]: integerOrThrow(row[countKey]) };
  }) as { daypart: (typeof DAYPARTS)[number]; orders: number }[] | { daypart: (typeof DAYPARTS)[number]; quantity: number }[];
};

export const normalizeVenueOrderMetrics = (
  raw: unknown,
  expectedBrandId: string,
  expectedVenueId: string,
): VenueOrderMetrics => {
  assertNoForbiddenKeys(raw);
  const row = objectOrThrow(raw);
  if (row.schema_version !== 1 || row.brand_id !== expectedBrandId || row.venue_id !== expectedVenueId) {
    throw new VenueOrderMetricsUnavailableError();
  }
  const authorized = booleanOrThrow(row.authorized);
  const resolvedTimezone = nullableStringOrThrow(row.resolved_timezone);
  const rawConfidence = row.tz_confidence;
  if (rawConfidence !== null && rawConfidence !== "iana" && rawConfidence !== "offset" && rawConfidence !== "utc") {
    throw new VenueOrderMetricsUnavailableError();
  }
  const timezoneConfidence = rawConfidence as VenueOrderTimezoneConfidence | null;
  if (authorized) {
    if (resolvedTimezone === null || timezoneConfidence === null || !validTimezone(resolvedTimezone, timezoneConfidence)) {
      throw new VenueOrderMetricsUnavailableError();
    }
  } else if (resolvedTimezone !== null || timezoneConfidence !== null) {
    throw new VenueOrderMetricsUnavailableError();
  }

  const windowRow = objectOrThrow(row.window);
  if (windowRow.days !== 30 || typeof windowRow.state !== "string" || !["unauthorized","none","early","ready"].includes(windowRow.state)) {
    throw new VenueOrderMetricsUnavailableError();
  }
  const localStartDate = isoDateOrNull(windowRow.local_start_date);
  const localEndDate = isoDateOrNull(windowRow.local_end_date);
  const dailyRows = arrayOrThrow(row.daily_30d);
  if (authorized && dailyRows.length !== 30) throw new VenueOrderMetricsUnavailableError();
  if (!authorized && dailyRows.length !== 0) throw new VenueOrderMetricsUnavailableError();
  const daily30d = dailyRows.map((rawDaily, index) => {
    const daily = objectOrThrow(rawDaily);
    const localDate = isoDateOrNull(daily.local_date);
    if (localDate === null) throw new VenueOrderMetricsUnavailableError();
    if (index > 0) {
      const prior = isoDateOrNull(objectOrThrow(dailyRows[index - 1]).local_date);
      if (prior === null || Date.parse(`${localDate}T00:00:00Z`) - Date.parse(`${prior}T00:00:00Z`) !== 86_400_000) {
        throw new VenueOrderMetricsUnavailableError();
      }
    }
    const salesCents = integerMoneyMapOrThrow(daily.sales_cents);
    const tipsCents = integerMoneyMapOrThrow(daily.tips_cents);
    const moneyStateByCurrency = moneyStateMapOrThrow(daily.money_state_by_currency);
    return {
      localDate,
      orders: integerOrThrow(daily.orders),
      salesCents,
      tipsCents,
      moneyStateByCurrency,
    };
  });
  if (authorized && (daily30d[0]?.localDate !== localStartDate || daily30d[29]?.localDate !== localEndDate)) {
    throw new VenueOrderMetricsUnavailableError();
  }

  const moneyStateByCurrency = moneyStateMapOrThrow(row.money_state_by_currency);
  const salesCents30d = integerMoneyMapOrThrow(row.sales_cents_30d);
  const tipsCents30d = integerMoneyMapOrThrow(row.tips_cents_30d);
  assertCompleteCurrencyMoney(salesCents30d, moneyStateByCurrency);
  assertCompleteCurrencyMoney(tipsCents30d, moneyStateByCurrency);
  for (const daily of daily30d) {
    if (!sameMoneyStates(daily.moneyStateByCurrency, moneyStateByCurrency)) {
      throw new VenueOrderMetricsUnavailableError();
    }
    assertCompleteCurrencyMoney(daily.salesCents, moneyStateByCurrency);
    assertCompleteCurrencyMoney(daily.tipsCents, moneyStateByCurrency);
  }

  const averages: Record<string, MoneyAverage> = {};
  for (const [currency, rawAverage] of Object.entries(objectOrThrow(row.spend_per_order))) {
    const average = objectOrThrow(rawAverage);
    averages[currencyOrThrow(currency)] = {
      salesCents: integerOrThrow(average.sales_cents),
      orders: integerOrThrow(average.orders),
      averageCents: integerOrThrow(average.average_cents),
    };
  }
  const covers: Record<string, CoverAverage> = {};
  for (const [currency, rawCover] of Object.entries(objectOrThrow(row.spend_per_cover_tier_a))) {
    const cover = objectOrThrow(rawCover);
    if (cover.sample_state !== "none" && cover.sample_state !== "measured") throw new VenueOrderMetricsUnavailableError();
    covers[currencyOrThrow(currency)] = {
      salesCents: integerOrThrow(cover.sales_cents), reservations: integerOrThrow(cover.reservations),
      sessions: integerOrThrow(cover.sessions), covers: integerOrThrow(cover.covers),
      averageCents: cover.average_cents === null ? null : integerOrThrow(cover.average_cents),
      sampleState: cover.sample_state, label: stringOrThrow(cover.label),
    };
  }
  const refundMap: Record<string, { orders: number; cents: number }> = {};
  for (const [currency, rawRefund] of Object.entries(objectOrThrow(row.unallocated_refunds_by_currency))) {
    const refund = objectOrThrow(rawRefund);
    refundMap[currencyOrThrow(currency)] = { orders: integerOrThrow(refund.orders), cents: integerOrThrow(refund.cents) };
  }
  for (const [currency, state] of Object.entries(moneyStateByCurrency)) {
    if (state === "partial_refund_unallocated") {
      const refund = refundMap[currency];
      if (refund === undefined || refund.orders === 0 || refund.cents === 0) {
        throw new VenueOrderMetricsUnavailableError();
      }
    } else if (refundMap[currency] !== undefined) {
      throw new VenueOrderMetricsUnavailableError();
    }
  }
  if (Object.keys(refundMap).some((currency) => moneyStateByCurrency[currency] !== "partial_refund_unallocated")) {
    throw new VenueOrderMetricsUnavailableError();
  }
  for (const currency of [...Object.keys(averages), ...Object.keys(covers)]) {
    if (moneyStateByCurrency[currency] !== "complete") {
      throw new VenueOrderMetricsUnavailableError();
    }
  }

  const items = arrayOrThrow(row.items_by_velocity).map((rawItem) => {
    const item = objectOrThrow(rawItem);
    const salesCents = integerMoneyMapOrThrow(item.sales_cents);
    const itemMoneyStates = moneyStateMapOrThrow(item.money_state_by_currency);
    assertCompleteCurrencyMoney(salesCents, moneyStateByCurrency);
    if (Object.entries(itemMoneyStates).some(([currency, state]) => moneyStateByCurrency[currency] !== state)) {
      throw new VenueOrderMetricsUnavailableError();
    }
    return {
      menuItemId: stringOrThrow(item.menu_item_id), itemNameSnapshot: stringOrThrow(item.item_name_snapshot),
      quantity: integerOrThrow(item.quantity), orders: integerOrThrow(item.orders), serviceDays: integerOrThrow(item.service_days),
      unitsPerServiceDay: finiteOrThrow(item.units_per_service_day),
      byDaypart: daypartsOrThrow(item.by_daypart, "quantity") as VenueOrderMetrics["itemsByVelocity"][number]["byDaypart"],
      salesCents, moneyStateByCurrency: itemMoneyStates,
    };
  });
  const zones = arrayOrThrow(row.revenue_by_zone).map((rawZone) => {
    const zone = objectOrThrow(rawZone);
    const salesCents = integerMoneyMapOrThrow(zone.sales_cents);
    const salesPerCurrentSeatCents = integerMoneyMapOrThrow(zone.sales_per_current_seat_cents);
    const zoneMoneyStates = moneyStateMapOrThrow(zone.money_state_by_currency);
    assertCompleteCurrencyMoney(salesCents, moneyStateByCurrency);
    assertCompleteCurrencyMoney(salesPerCurrentSeatCents, moneyStateByCurrency);
    if (Object.entries(zoneMoneyStates).some(([currency, state]) => moneyStateByCurrency[currency] !== state)) {
      throw new VenueOrderMetricsUnavailableError();
    }
    return {
      zone: stringOrThrow(zone.zone), orders: integerOrThrow(zone.orders), sessions: integerOrThrow(zone.sessions),
      currentSeatCapacity: zone.current_seat_capacity === null ? null : integerOrThrow(zone.current_seat_capacity),
      salesCents, salesPerCurrentSeatCents,
      moneyStateByCurrency: zoneMoneyStates,
    };
  });
  const rooms = arrayOrThrow(row.revenue_by_room).map((rawRoom) => {
    const room = objectOrThrow(rawRoom);
    const salesCents = integerMoneyMapOrThrow(room.sales_cents);
    const roomMoneyStates = moneyStateMapOrThrow(room.money_state_by_currency);
    assertCompleteCurrencyMoney(salesCents, moneyStateByCurrency);
    if (Object.entries(roomMoneyStates).some(([currency, state]) => moneyStateByCurrency[currency] !== state)) {
      throw new VenueOrderMetricsUnavailableError();
    }
    return {
      stayUnitId: stringOrThrow(room.stay_unit_id), spotLabelSnapshot: stringOrThrow(room.spot_label_snapshot),
      orders: integerOrThrow(room.orders), sessions: integerOrThrow(room.sessions),
      salesCents, moneyStateByCurrency: roomMoneyStates,
    };
  });
  const attach = objectOrThrow(row.attach_counts);
  if (attach.state !== "not_applicable" && attach.state !== "counted") throw new VenueOrderMetricsUnavailableError();
  const completeness = objectOrThrow(row.data_completeness);
  const channel = objectOrThrow(row.channel_split);
  const weekdays = arrayOrThrow(row.placed_at_by_iso_weekday).map((rawWeekday, index) => {
    const weekday = objectOrThrow(rawWeekday);
    if (weekday.iso_weekday !== index + 1) throw new VenueOrderMetricsUnavailableError();
    return { isoWeekday: index + 1, orders: integerOrThrow(weekday.orders) };
  });
  if (weekdays.length !== 7) throw new VenueOrderMetricsUnavailableError();

  const result: VenueOrderMetrics = {
    schemaVersion: 1, brandId: expectedBrandId, venueId: expectedVenueId, authorized,
    resolvedTimezone, timezoneConfidence,
    window: {
      days: 30, localStartDate, localEndDate, captureStartedAt: isoDateOrNull(windowRow.capture_started_at),
      windowComplete: booleanOrThrow(windowRow.window_complete), serviceDays: integerOrThrow(windowRow.service_days),
      state: windowRow.state as VenueOrderWindowState, thinLabel: nullableStringOrThrow(windowRow.thin_label),
    },
    orders30d: integerOrThrow(row.orders_30d),
    channelSplit: { qr: integerOrThrow(channel.qr), page: integerOrThrow(channel.page), counter_pickup: integerOrThrow(channel.counter_pickup), staff: integerOrThrow(channel.staff) },
    moneyStateByCurrency, unallocatedRefundsByCurrency: refundMap, salesCents30d, tipsCents30d,
    spendPerOrder: averages, spendPerCoverTierA: covers,
    tierACurrencyConflictReservations: integerOrThrow(row.tier_a_currency_conflict_reservations),
    attachCounts: { state: attach.state, orderedReservations: integerOrThrow(attach.ordered_reservations), seatedReservations: integerOrThrow(attach.seated_reservations), windowComplete: booleanOrThrow(attach.window_complete) },
    placedAtByDaypart: daypartsOrThrow(row.placed_at_by_daypart, "orders") as VenueOrderMetrics["placedAtByDaypart"],
    placedAtByIsoWeekday: weekdays, daily30d, itemsByVelocity: items, revenueByZone: zones, revenueByRoom: rooms,
    dataCompleteness: {
      activeTablesMissingZone: integerOrThrow(completeness.active_tables_missing_zone),
      soldItemsMissingCost: integerOrThrow(completeness.sold_items_missing_cost),
      tierACurrencyConflictReservations: integerOrThrow(completeness.tier_a_currency_conflict_reservations),
      showZoneTodo: booleanOrThrow(completeness.show_zone_todo), showItemCostTodo: booleanOrThrow(completeness.show_item_cost_todo),
    },
  };
  if (!authorized && (result.orders30d !== 0 || result.window.state !== "unauthorized" || Object.keys(result.moneyStateByCurrency).length !== 0)) {
    throw new VenueOrderMetricsUnavailableError();
  }
  if (!authorized && (
    result.window.localStartDate !== null ||
    result.window.localEndDate !== null ||
    result.window.captureStartedAt !== null ||
    result.window.windowComplete ||
    result.window.serviceDays !== 0 ||
    result.window.thinLabel !== null ||
    Object.values(result.channelSplit).some((count) => count !== 0) ||
    Object.keys(result.unallocatedRefundsByCurrency).length !== 0 ||
    Object.keys(result.salesCents30d).length !== 0 ||
    Object.keys(result.tipsCents30d).length !== 0 ||
    Object.keys(result.spendPerOrder).length !== 0 ||
    Object.keys(result.spendPerCoverTierA).length !== 0 ||
    result.tierACurrencyConflictReservations !== 0 ||
    result.attachCounts.orderedReservations !== 0 ||
    result.attachCounts.seatedReservations !== 0 ||
    result.attachCounts.windowComplete ||
    result.placedAtByDaypart.some((entry) => entry.orders !== 0) ||
    result.placedAtByIsoWeekday.some((entry) => entry.orders !== 0) ||
    result.itemsByVelocity.length !== 0 ||
    result.revenueByZone.length !== 0 ||
    result.revenueByRoom.length !== 0 ||
    result.dataCompleteness.activeTablesMissingZone !== 0 ||
    result.dataCompleteness.soldItemsMissingCost !== 0 ||
    result.dataCompleteness.tierACurrencyConflictReservations !== 0 ||
    result.dataCompleteness.showZoneTodo ||
    result.dataCompleteness.showItemCostTodo
  )) {
    throw new VenueOrderMetricsUnavailableError();
  }
  return result;
};

export const fetchVenueOrderMetrics = async (
  brandId: string,
  venueId: string,
): Promise<VenueOrderMetrics> => {
  let response: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    response = await withTimeout(
      supabase.rpc("venue_order_metrics_rollup", { p_brand_id: brandId, p_venue_id: venueId }),
      DATA_FETCH_TIMEOUT_MS,
      "venue_order_metrics_rollup",
    );
  } catch {
    throw new VenueOrderMetricsRequestError();
  }
  if (response.error !== null) throw new VenueOrderMetricsRequestError();
  return normalizeVenueOrderMetrics(response.data, brandId, venueId);
};
