import type { CheckoutPaymentMethod } from "../components/checkout/CartContext";
import { normalizeCurrency } from "./currency";

export type MoneySource = "order" | "door_sale" | "refund" | "legacy_brand";
export type MoneyDoorPaymentMethod = "cash" | "card_reader" | "nfc" | "manual";

type MoneyRefund = { amount?: number; amountGbp: number };

type MoneyOrderRecord = {
  id: string;
  totalAtPurchase?: number;
  totalGbpAtPurchase: number;
  refundedAmount?: number;
  refundedAmountGbp: number;
  currency: string;
  status: "paid" | "refunded_full" | "refunded_partial" | "cancelled";
  paymentMethod: CheckoutPaymentMethod;
  refunds: MoneyRefund[];
};

type MoneyDoorSaleRecord = {
  id: string;
  totalAtSale?: number;
  totalGbpAtSale: number;
  refundedAmount?: number;
  refundedAmountGbp: number;
  currency: string;
  paymentMethod: MoneyDoorPaymentMethod;
  refunds: MoneyRefund[];
};

export interface CurrencyMismatch {
  source: MoneySource;
  id: string;
  expectedCurrency: string;
  actualCurrency: string;
  amount: number;
}

export interface CurrencyBreakdown {
  currency: string;
  amount: number;
  count: number;
}

export interface EventMoneySummary {
  expectedCurrency: string;
  onlineRevenue: number;
  doorRevenue: number;
  grossRevenue: number;
  onlineRefunded: number;
  doorRefunded: number;
  totalRefunded: number;
  payoutEstimate: number;
  revenueByMethod: Partial<Record<CheckoutPaymentMethod | MoneyDoorPaymentMethod, number>>;
  byCurrency: CurrencyBreakdown[];
  mismatches: CurrencyMismatch[];
  currenciesPresent: string[];
}

export interface LegacyBrandFinanceSummary {
  currency: string;
  grossSales: number;
  totalRefunds: number;
  eventCount: number;
  hasLegacyMoney: boolean;
  mismatches: CurrencyMismatch[];
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

const addCurrency = (
  map: Map<string, CurrencyBreakdown>,
  currency: string,
  amount: number,
): void => {
  const current = map.get(currency) ?? { currency, amount: 0, count: 0 };
  current.amount = round2(current.amount + amount);
  current.count += 1;
  map.set(currency, current);
};

export const orderLiveAmount = (order: MoneyOrderRecord): number =>
  Math.max(
    0,
    (order.totalAtPurchase ?? order.totalGbpAtPurchase) -
      (order.refundedAmount ?? order.refundedAmountGbp),
  );

export const doorSaleLiveAmount = (sale: MoneyDoorSaleRecord): number =>
  Math.max(
    0,
    (sale.totalAtSale ?? sale.totalGbpAtSale) -
      (sale.refundedAmount ?? sale.refundedAmountGbp),
  );

export const refundAmount = (refund: { amount?: number; amountGbp: number }): number =>
  refund.amount ?? refund.amountGbp;

export const summarizeEventMoney = (args: {
  expectedCurrency?: string | null;
  orders: MoneyOrderRecord[];
  doorSales: MoneyDoorSaleRecord[];
}): EventMoneySummary => {
  const expectedCurrency = normalizeCurrency(args.expectedCurrency);
  const byCurrency = new Map<string, CurrencyBreakdown>();
  const mismatches: CurrencyMismatch[] = [];
  const revenueByMethod: EventMoneySummary["revenueByMethod"] = {};
  let onlineRevenue = 0;
  let doorRevenue = 0;
  let onlineRefunded = 0;
  let doorRefunded = 0;

  const addRevenue = (
    method: CheckoutPaymentMethod | MoneyDoorPaymentMethod,
    amount: number,
  ): void => {
    revenueByMethod[method] = round2((revenueByMethod[method] ?? 0) + amount);
  };

  for (const order of args.orders) {
    const currency = normalizeCurrency(order.currency);
    const isRevenueLive =
      order.status === "paid" || order.status === "refunded_partial";
    const live = isRevenueLive ? orderLiveAmount(order) : 0;
    if (live > 0) addCurrency(byCurrency, currency, live);
    for (const refund of order.refunds) {
      const amount = refundAmount(refund);
      if (amount > 0) addCurrency(byCurrency, currency, amount);
      if (currency === expectedCurrency) onlineRefunded += amount;
    }
    if (currency !== expectedCurrency) {
      if (live > 0) {
        mismatches.push({
          source: "order",
          id: order.id,
          expectedCurrency,
          actualCurrency: currency,
          amount: live,
        });
      }
      continue;
    }
    onlineRevenue += live;
    if (live > 0) addRevenue(order.paymentMethod, live);
  }

  for (const sale of args.doorSales) {
    const currency = normalizeCurrency(sale.currency);
    const live = doorSaleLiveAmount(sale);
    if (live > 0) addCurrency(byCurrency, currency, live);
    for (const refund of sale.refunds) {
      const amount = refundAmount(refund);
      if (amount > 0) addCurrency(byCurrency, currency, amount);
      if (currency === expectedCurrency) doorRefunded += amount;
    }
    if (currency !== expectedCurrency) {
      if (live > 0) {
        mismatches.push({
          source: "door_sale",
          id: sale.id,
          expectedCurrency,
          actualCurrency: currency,
          amount: live,
        });
      }
      continue;
    }
    doorRevenue += live;
    if (live > 0) addRevenue(sale.paymentMethod, live);
  }

  const grossRevenue = round2(onlineRevenue + doorRevenue);
  const totalRefunded = round2(onlineRefunded + doorRefunded);
  return {
    expectedCurrency,
    onlineRevenue: round2(onlineRevenue),
    doorRevenue: round2(doorRevenue),
    grossRevenue,
    onlineRefunded: round2(onlineRefunded),
    doorRefunded: round2(doorRefunded),
    totalRefunded,
    payoutEstimate: round2(round2(onlineRevenue * 0.96) + doorRevenue),
    revenueByMethod,
    byCurrency: Array.from(byCurrency.values()).sort((a, b) =>
      a.currency.localeCompare(b.currency),
    ),
    mismatches,
    currenciesPresent: Array.from(byCurrency.keys()).sort(),
  };
};

export const summarizeLegacyBrandFinance = (args: {
  brandCurrency?: string | null;
  events: Array<{ id: string; revenueGbp: number }>;
  refunds: Array<{ id: string; amountGbp: number }>;
}): LegacyBrandFinanceSummary => {
  const brandCurrency = normalizeCurrency(args.brandCurrency);
  const grossSales = round2(args.events.reduce((sum, event) => sum + event.revenueGbp, 0));
  const totalRefunds = round2(args.refunds.reduce((sum, refund) => sum + refund.amountGbp, 0));
  const hasLegacyMoney = grossSales > 0 || totalRefunds > 0;
  const mismatches =
    hasLegacyMoney && brandCurrency !== "GBP"
      ? [
          ...args.events
            .filter((event) => event.revenueGbp > 0)
            .map((event): CurrencyMismatch => ({
              source: "legacy_brand",
              id: event.id,
              expectedCurrency: brandCurrency,
              actualCurrency: "GBP",
              amount: event.revenueGbp,
            })),
          ...args.refunds
            .filter((refund) => refund.amountGbp > 0)
            .map((refund): CurrencyMismatch => ({
              source: "legacy_brand",
              id: refund.id,
              expectedCurrency: brandCurrency,
              actualCurrency: "GBP",
              amount: refund.amountGbp,
            })),
        ]
      : [];

  return {
    currency: "GBP", // legacy BrandEventStub finance rows are GBP-only.
    grossSales,
    totalRefunds,
    eventCount: args.events.filter((event) => event.revenueGbp > 0).length,
    hasLegacyMoney,
    mismatches,
  };
};

export const effectiveDraftCurrency = (
  draftCurrency?: string | null,
  brandCurrency?: string | null,
): string => {
  const code = (draftCurrency ?? brandCurrency)?.trim().toUpperCase();
  return code !== undefined && code.length > 0 ? code : "";
};
