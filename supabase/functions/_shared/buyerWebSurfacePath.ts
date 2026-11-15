// #3645 / #2190 — buyer-web checkout surface path for hosted-provider returns.
//
// The Host buyer web app serves three checkout surfaces, one per event_type:
//   trip       → /checkout-trip/{id}/{confirm|payment}
//   experience → /checkout-experience/{id}/{confirm|payment}
//   (else)     → /checkout/{id}/{confirm|payment}
//
// Both hosted providers (Stripe Checkout success/cancel URLs and the Paystack
// per-transaction callback_url) MUST return the buyer to the surface that owns
// the offering. Before #3645 only `trip` was branched, so an experience buyer
// was sent back to /checkout/{id}/confirm — the wrong surface.
//
// Strict equality on the literal event_type: anything that is not exactly
// "trip" or "experience" (null, undefined, "TRIP", "draft", ...) falls back to
// the single-event surface.

export type BuyerWebSurfacePath =
  | "checkout-trip"
  | "checkout-experience"
  | "checkout";

export function buyerWebSurfacePath(eventType: unknown): BuyerWebSurfacePath {
  if (eventType === "trip") return "checkout-trip";
  if (eventType === "experience") return "checkout-experience";
  return "checkout";
}
