/**
 * Currency exchange rate service.
 * Fetches real USD-based rates from exchangerate-api.com and caches them.
 * Falls back to static rates when offline or on error.
 */

const EXCHANGE_RATE_API_URL = "https://api.exchangerate-api.com/v4/latest/USD";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// RELIABILITY: These fallback rates are used when the live API (exchangerate-api.com)
// is unreachable. They should be updated periodically. Last updated: 2026-03-25.
// Live rates are fetched with 24h cache — fallbacks only matter during API outages.
const FALLBACK_RATES: Record<string, number> = {
  USD: 1.0,
  AUD: 1.35,
  BIF: 2000.0,
  BRL: 5.15,
  BWP: 11.2,
  CAD: 1.25,
  CHF: 0.92,
  CNY: 6.45,
  CVE: 95.8,
  CZK: 21.5,
  DJF: 177.0,
  DKK: 6.34,
  DZD: 134.0,
  EGP: 50.0,
  ERN: 15.0,
  ETB: 50.8,
  EUR: 0.85,
  GBP: 0.73,
  GHS: 12.05,
  GMD: 53.5,
  GNF: 8600.0,
  HKD: 7.78,
  HUF: 298.0,
  ILS: 3.25,
  INR: 74.8,
  JPY: 110.0,
  KES: 155.0,
  KMF: 425.0,
  KRW: 1180.0,
  LRD: 151.0,
  LSL: 14.2,
  LYD: 4.8,
  MAD: 10.1,
  MGA: 4150.0,
  MRU: 36.8,
  MUR: 44.2,
  MXN: 17.8,
  NAD: 14.2,
  NGN: 1600.0,
  NOK: 8.85,
  NZD: 1.42,
  PLN: 3.89,
  RUB: 74.5,
  RWF: 1020.0,
  SCR: 13.4,
  SDG: 600.0,
  SEK: 8.95,
  SGD: 1.32,
  SLL: 11500.0,
  SOS: 570.0,
  SSP: 130.2,
  SZL: 14.2,
  TND: 3.1,
  TRY: 38.0,
  TZS: 2320.0,
  UGX: 3650.0,
  XOF: 565.0,
  ZAR: 14.2,
};

let cachedRates: Record<string, number> = { ...FALLBACK_RATES };
let lastFetchedAt = 0;
let fetchPromise: Promise<void> | null = null;

/**
 * Fetch latest rates from API and update cache. Uses fallback on error or offline.
 */
export async function fetchExchangeRates(): Promise<void> {
  const now = Date.now();
  if (now - lastFetchedAt < CACHE_TTL_MS && Object.keys(cachedRates).length > 1) {
    return; // Use cache if still valid (we have more than just fallback)
  }
  if (fetchPromise) {
    return fetchPromise;
  }

  fetchPromise = (async () => {
    try {
      const res = await fetch(EXCHANGE_RATE_API_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rates = data?.rates as Record<string, number> | undefined;
      if (rates && typeof rates.USD === "number") {
        cachedRates = { ...FALLBACK_RATES, ...rates };
        lastFetchedAt = Date.now();
      }
    } catch (_e) {
      // Keep existing cache or fallback
      if (lastFetchedAt === 0) {
        cachedRates = { ...FALLBACK_RATES };
      }
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

/**
 * Get the exchange rate for a currency code (1 USD = rate units of currency).
 */
export function getRate(currencyCode: string): number {
  const code = currencyCode?.toUpperCase() || "USD";
  return cachedRates[code] ?? FALLBACK_RATES[code] ?? 1.0;
}

/**
 * Get all currently cached rates (for display or debugging).
 */
export function getRates(): Record<string, number> {
  return { ...cachedRates };
}

/**
 * Preload rates (e.g. on app start). Safe to call multiple times.
 */
export function preloadRates(): void {
  fetchExchangeRates();
}
