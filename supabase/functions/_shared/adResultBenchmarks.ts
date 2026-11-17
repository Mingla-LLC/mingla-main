/**
 * #4238 item 2 — the industry benchmark model, moved unchanged out of
 * growth-tools-events/index.ts so Growth Tools and the Host budget guidance
 * read ONE copy (values byte-equal to the Growth Tools originals).
 *
 * Sources (2025 data): Meta entertainment CPC ~$0.40–0.70 (one of the cheapest
 * verticals); event ticketing landing→ticket ~2–10%; free landing→RSVP
 * ~15–25%. A ±25% band produces the low/high range. Pure: no I/O.
 */

/** The low / high band applied around a mid estimate. */
export const BAND_LOW = 0.75;
export const BAND_HIGH = 1.25;

/**
 * PAID: an ad click that lands → buys a ticket. Cheaper tickets convert
 * better. The thresholds are written in major units; Growth Tools passes the
 * event's own currency (X-6, flagged for its owner); the Host guidance passes
 * the USD equivalent price so a ₦5,000 ticket is not banded like $5,000.
 */
export function landingToTicket(price: number): number {
  if (price < 20) return 0.08;
  if (price < 50) return 0.06;
  if (price < 100) return 0.045;
  return 0.03;
}

/** FREE: an ad click that lands → RSVPs (no purchase friction, so far higher). */
export const LANDING_TO_RSVP = 0.20;

/**
 * Event-ad CPC in the currency's MAJOR units. A currency missing here uses
 * the USD figure (typicalCpcKnown says whether it was assumed).
 */
export const FALLBACK_CPC: Record<string, number> = {
  USD: 0.50,
  GBP: 0.42,
  EUR: 0.48,
  CAD: 0.65,
  AUD: 0.70,
  NGN: 55,
  INR: 11,
  ZAR: 3.8,
  AED: 1.9,
  NZD: 0.75,
};

export function typicalCpc(currency: string): number {
  return FALLBACK_CPC[currency] ?? 0.50;
}

export function typicalCpcKnown(currency: string): boolean {
  return Object.prototype.hasOwnProperty.call(FALLBACK_CPC, currency);
}
