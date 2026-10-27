// Issue #4130 (Wave 2b) — Pricing › "What one sale earns".
//
// Pure: no React, no Supabase. Mirrors the checkout's integer money math
// (allInPricingEngine: fee = round(ticket × bps / 10000)), with the fee passed
// to the buyer: the host gets the full ticket price, the buyer pays ticket +
// fee, and Mingla pays card processing out of the fee.
//
// Processing uses each provider's PUBLISHED card rate (not an average of what
// was charged), so the page can say exactly where the number comes from:
//   Paystack, Nigeria local cards: 1.5% + ₦100, the ₦100 waived under ₦2,500,
//     capped at ₦2,000 (https://paystack.com/pricing).
//   Stripe, US cards: 2.9% + 30¢ (https://stripe.com/pricing).

export const SERVICE_FEE_BPS = 300;

export const PROCESSING_RATES = {
  NGN: {
    provider: "Paystack",
    label: "Paystack's published local card rate (1.5% + ₦100, capped at ₦2,000)",
    cost(chargedMinor) {
      const flat = chargedMinor < 250_000 ? 0 : 10_000;
      return Math.min(Math.round(chargedMinor * 0.015) + flat, 200_000);
    },
  },
  USD: {
    provider: "Stripe",
    label: "Stripe's published US card rate (2.9% + 30¢)",
    cost(chargedMinor) {
      return Math.round(chargedMinor * 0.029) + 30;
    },
  },
};

export const SALE_PRESETS = [
  { id: "ngn-small", currency: "NGN", ticketMinor: 550_000, label: "₦5,500 ticket" },
  { id: "ngn-large", currency: "NGN", ticketMinor: 5_000_000, label: "₦50,000 ticket" },
  { id: "usd", currency: "USD", ticketMinor: 3_200, label: "$32 ticket" },
];

function feeFromBps(baseMinor, bps) {
  return Math.round((baseMinor * bps) / 10000);
}

/**
 * One sale at `takeBps` (Mingla's take portion) + the 3% service portion.
 * Returns minor units: { ticket, fee, feeBps, buyerPays, processing, profit,
 * keptShare } where keptShare is profit ÷ fee (0–1, may be negative), or null
 * when the inputs cannot be priced.
 */
export function saleEarnings({ ticketMinor, takeBps, currency }) {
  const rate = PROCESSING_RATES[currency];
  const ticket = Number(ticketMinor);
  const take = Number(takeBps);
  if (!rate || !Number.isInteger(ticket) || ticket <= 0 || !Number.isFinite(take) || take < 0) return null;
  const feeBps = take + SERVICE_FEE_BPS;
  const fee = feeFromBps(ticket, feeBps);
  const buyerPays = ticket + fee;
  const processing = rate.cost(buyerPays);
  const profit = fee - processing;
  return {
    ticket,
    fee,
    feeBps,
    buyerPays,
    processing,
    profit,
    keptShare: fee > 0 ? profit / fee : null,
  };
}

/** Major-unit text for a minor amount, e.g. formatMinor(550000, "NGN") → "₦5,500.00". */
export function formatMinor(minor, currency) {
  const value = Number(minor) / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}
