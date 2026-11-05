import type { CheckoutPaymentMethod } from "../components/checkout/CartContext";
import {
  isCardDoorPaymentMethod,
  type DoorPaymentMethod,
} from "../types/doorSales";
import { currencyCodeOrNull, normalizeCurrency } from "./currency";
import {
  assertOrderCurrencyForMoney,
  assertRefundCurrencyForMoney,
} from "./orderCurrencyContract";

export type MoneySource = "order" | "door_sale" | "refund" | "legacy_brand";
export type MoneyDoorPaymentMethod = DoorPaymentMethod;

type MoneyRefund = {
  amount?: number;
  amountGbp: number;
  currency?: string | null;
  /** ORCH-0796 — app-fee portion of the refund in minor units. */
  applicationFeeRefundedCents?: number | null;
  applicationFeeRefundStatus?: string;
};

type MoneyOrderRecord = {
  id: string;
  totalAtPurchase?: number;
  totalGbpAtPurchase: number;
  refundedAmount?: number;
  refundedAmountGbp: number;
  /** ORCH-0796 — minor-unit precision sources for expectedPayout computation. */
  totalCents?: number;
  refundedAmountCents?: number;
  applicationFeeAmountCents?: number;
  stripeApplicationFeeAmountCents?: number | null;
  currency: string | null;
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
  /** issue #4271 — Mingla's fee on a card door sale (major units). */
  minglaFeeAmount?: number | null;
};

export interface CurrencyMismatch {
  source: MoneySource;
  id: string;
  expectedCurrency: string | null;
  actualCurrency: string;
  amount: number;
}

export interface CurrencyBreakdown {
  currency: string;
  amount: number;
  count: number;
}

export interface EventMoneySummary {
  expectedCurrency: string | null;
  onlineRevenue: number;
  doorRevenue: number;
  grossRevenue: number;
  onlineRefunded: number;
  doorRefunded: number;
  totalRefunded: number;
  /**
   * Net to the organiser's Stripe account from online sales only, in
   * expected-currency major units. Derived from real per-order Stripe
   * application-fee columns. Null when no online activity exists. ORCH-0796.
   */
  onlineNetMajor: number | null;
  /**
   * Sum of Stripe application fees on online sales (major units). Equals
   * `onlineRevenue - onlineNetMajor - onlineRefunded + appFeeRefunded`. Null
   * when no online activity exists. ORCH-0796.
   */
  /** @deprecated Compatibility alias; this is Mingla's application fee, not processing. */
  stripeFeeOnlineMajor: number | null;
  /** Mingla application fee retained on online sales. */
  minglaFeeOnlineMajor: number | null;
  /**
   * Expected net to the organiser's Stripe account from this event, in
   * expected-currency major units. Sum of online net + cash door revenue.
   * Null when no payments (online or door) exist — signals UI to render "—".
   * ORCH-0796.
   */
  expectedPayoutMajor: number | null;
  /**
   * issue #4271 — Mingla's fee on card door sales (Buyer's phone, Tap to pay)
   * in expected-currency major units. Cash and manual carry no fee. Card
   * money is paid out with online sales.
   */
  doorCardMinglaFee: number;
  /** Door revenue less that fee. Null while a card refund's fee is unconfirmed. */
  doorNet: number | null;
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

const CARD_BRAND_NAMES: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  verve: "Verve",
  eftpos: "EFTPOS",
};

/** "Visa ending 4242", or null when the provider supplied no last four. */
export const doorSaleCardLine = (
  brand: string | null | undefined,
  last4: string | null | undefined,
): string | null => {
  if (typeof last4 !== "string" || last4.length === 0) return null;
  const name = typeof brand === "string" ? CARD_BRAND_NAMES[brand] : undefined;
  return `${name ?? "Card"} ending ${last4}`;
};

/**
 * issue #4271 — the one money shape of a door sale, read from the server's own
 * columns (charge, refunds, fee, and each refund's fee reversal as the provider
 * reported it). Every surface reads this: sale detail, door list, hub,
 * reconciliation and CSV.
 *
 * Net is what the host keeps before the provider's own cost: charge, less the
 * refund, less the fee Mingla still holds. Null while a refund's fee reversal is
 * unconfirmed: a guess here is a wrong number on an accountant's sheet.
 */
export interface DoorSaleMoney {
  charged: number;
  refunded: number;
  /** Charge left after refunds. */
  live: number;
  /** Mingla's fee still held (the fee less what came back). 0 for cash/manual. */
  minglaFee: number;
  net: number | null;
}

export const doorSaleMoney = (sale: MoneyDoorSaleRecord): DoorSaleMoney => {
  const charged = sale.totalAtSale ?? sale.totalGbpAtSale;
  const refunded = sale.refundedAmount ?? sale.refundedAmountGbp;
  const live = doorSaleLiveAmount(sale);
  if (!isCardDoorPaymentMethod(sale.paymentMethod)) {
    return { charged, refunded, live: round2(live), minglaFee: 0, net: round2(live) };
  }
  const feeCents = Math.round(Math.max(0, sale.minglaFeeAmount ?? 0) * 100);
  let feeBackCents = 0;
  let feeBackKnown = true;
  for (const refund of sale.refunds) {
    if (refund.applicationFeeRefundedCents === null && refundAmount(refund) > 0) {
      feeBackKnown = false;
    }
    feeBackCents += refund.applicationFeeRefundedCents ?? 0;
  }
  const minglaFee = Math.max(0, feeCents - feeBackCents) / 100;
  return {
    charged,
    refunded,
    live: round2(live),
    minglaFee,
    net: feeBackKnown ? round2(Math.max(0, live - minglaFee)) : null,
  };
};

const singleStoredMoneyCurrency = (
  orders: MoneyOrderRecord[],
  doorSales: MoneyDoorSaleRecord[],
): string | null => {
  const currencies = new Set<string>();
  const add = (value: string | null | undefined): void => {
    const currency = currencyCodeOrNull(value);
    if (currency !== null) currencies.add(currency);
  };

  for (const order of orders) {
    const total = order.totalAtPurchase ?? order.totalGbpAtPurchase;
    const refunded = order.refundedAmount ?? order.refundedAmountGbp;
    if (total > 0 || refunded > 0) add(order.currency);
    for (const refund of order.refunds) {
      if (refundAmount(refund) > 0) {
        add(refund.currency === undefined ? order.currency : refund.currency);
      }
    }
  }
  for (const sale of doorSales) {
    const total = sale.totalAtSale ?? sale.totalGbpAtSale;
    const refunded = sale.refundedAmount ?? sale.refundedAmountGbp;
    if (total > 0 || refunded > 0 || sale.refunds.some((refund) => refundAmount(refund) > 0)) {
      add(sale.currency);
    }
  }

  return currencies.size === 1 ? [...currencies][0] : null;
};

export const summarizeEventMoney = (args: {
  expectedCurrency?: string | null;
  orders: MoneyOrderRecord[];
  doorSales: MoneyDoorSaleRecord[];
}): EventMoneySummary => {
  // #2411 + #962 — an unset event/brand currency is not permission to invent
  // GBP, but it must not erase real money either. A single currency carried by
  // the money-bearing records is authoritative; zero-money rows establish none.
  const expectedCurrency =
    currencyCodeOrNull(args.expectedCurrency)
    ?? singleStoredMoneyCurrency(args.orders, args.doorSales);
  const byCurrency = new Map<string, CurrencyBreakdown>();
  const mismatches: CurrencyMismatch[] = [];
  const revenueByMethod: EventMoneySummary["revenueByMethod"] = {};
  let onlineRevenue = 0;
  let doorRevenue = 0;
  let onlineRefunded = 0;
  let doorRefunded = 0;
  // ORCH-0796 — net-to-organiser accumulators (minor units for precision).
  // Only paid + refunded_partial orders in the expected currency contribute.
  let onlineNetCents = 0;
  let minglaFeeOnlineCents = 0;
  let hasAnyOnlinePayment = false;
  let hasAnyDoorPayment = false;
  let hasUnknownApplicationFeeRefund = false;
  let doorCardMinglaFee = 0;
  let doorFeeUnknown = false;

  const addRevenue = (
    method: CheckoutPaymentMethod | MoneyDoorPaymentMethod,
    amount: number,
  ): void => {
    revenueByMethod[method] = round2((revenueByMethod[method] ?? 0) + amount);
  };

  for (const order of args.orders) {
    const currency = currencyCodeOrNull(order.currency);
    const isRevenueLive =
      order.status === "paid" || order.status === "refunded_partial";
    const live = isRevenueLive ? orderLiveAmount(order) : 0;
    const totalAmount = order.totalAtPurchase ?? order.totalGbpAtPurchase;
    const refundedAmount = order.refundedAmount ?? order.refundedAmountGbp;
    assertOrderCurrencyForMoney(
      currency,
      totalAmount > 0 || refundedAmount > 0,
    );
    if (live > 0 && currency !== null) addCurrency(byCurrency, currency, live);
    for (const refund of order.refunds) {
      const amount = refundAmount(refund);
      // Legacy in-memory refund fixtures predate a refund currency field and
      // inherit their already-validated parent order currency. An explicit
      // null is current server data and must fail closed for positive money.
      const refundCurrency =
        refund.currency === undefined
          ? currency
          : currencyCodeOrNull(refund.currency);
      assertRefundCurrencyForMoney(currency, refundCurrency, amount > 0);
      if (amount > 0 && refundCurrency !== null) {
        addCurrency(byCurrency, refundCurrency, amount);
      }
      if (refundCurrency === expectedCurrency) onlineRefunded += amount;
    }
    if (currency === null) continue;
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

    // ORCH-0796 — net-to-organiser per order from real Stripe columns.
    // Only paid + refunded_partial orders contribute (refunded_full nets to 0 via the
    // total - refunded subtraction; cancelled never went through Stripe).
    if (isRevenueLive && totalAmount > 0) {
      hasAnyOnlinePayment = true;
      const totalCents = order.totalCents
        ?? Math.round((order.totalAtPurchase ?? order.totalGbpAtPurchase) * 100);
      // Prefer Stripe-confirmed app fee; fall back to Mingla-intended when webhook
      // hasn't landed yet. Treat null/undefined → 0 (defensive; real paid orders
      // should always carry one of the two values).
      const appFeeCents = order.stripeApplicationFeeAmountCents
        ?? order.applicationFeeAmountCents
        ?? 0;
      const refundedCents = order.refundedAmountCents
        ?? Math.round((order.refundedAmount ?? order.refundedAmountGbp) * 100);
      const appFeeRefundedCents = order.refunds.reduce((acc, r) => {
        if (r.applicationFeeRefundedCents === null && refundAmount(r) > 0) {
          hasUnknownApplicationFeeRefund = true;
          return acc;
        }
        return acc + (r.applicationFeeRefundedCents ?? 0);
      }, 0);
      // Destination-charge model: organiser receives (total - app_fee), reduced
      // by net refunds (refund_amount - app_fee_refunded). Math.max guards a
      // pathological refund-overshoot edge case.
      const net = Math.max(0, totalCents - appFeeCents - refundedCents + appFeeRefundedCents);
      onlineNetCents += net;
      minglaFeeOnlineCents += Math.max(0, appFeeCents - appFeeRefundedCents);
    }
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
    if (live > 0) {
      addRevenue(sale.paymentMethod, live);
      hasAnyDoorPayment = true;
    }
    if (isCardDoorPaymentMethod(sale.paymentMethod)) {
      const money = doorSaleMoney(sale);
      doorCardMinglaFee += money.minglaFee;
      if (money.net === null) {
        doorFeeUnknown = true;
        hasUnknownApplicationFeeRefund = true;
      }
      // A fully refunded card sale still has a real payout: zero, not "no payments".
      if (money.charged > 0) hasAnyDoorPayment = true;
    }
  }

  const grossRevenue = round2(onlineRevenue + doorRevenue);
  const totalRefunded = round2(onlineRefunded + doorRefunded);

  // ORCH-0796 — null signals "no payments" so UI renders "—" instead of £0.00.
  const onlineNetMajor = hasAnyOnlinePayment && !hasUnknownApplicationFeeRefund ? round2(onlineNetCents / 100) : null;
  const minglaFeeOnlineMajor = hasAnyOnlinePayment && !hasUnknownApplicationFeeRefund ? round2(minglaFeeOnlineCents / 100) : null;
  const expectedPayoutMajor =
    (hasAnyOnlinePayment || hasAnyDoorPayment) && !hasUnknownApplicationFeeRefund
      ? round2(
          (onlineNetCents / 100) +
            (hasAnyDoorPayment ? doorRevenue - doorCardMinglaFee : 0),
        )
      : null;

  return {
    expectedCurrency,
    onlineRevenue: round2(onlineRevenue),
    doorRevenue: round2(doorRevenue),
    grossRevenue,
    onlineRefunded: round2(onlineRefunded),
    doorRefunded: round2(doorRefunded),
    totalRefunded,
    onlineNetMajor,
    stripeFeeOnlineMajor: minglaFeeOnlineMajor,
    minglaFeeOnlineMajor,
    expectedPayoutMajor,
    doorCardMinglaFee: round2(doorCardMinglaFee),
    doorNet: doorFeeUnknown ? null : round2(doorRevenue - doorCardMinglaFee),
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
