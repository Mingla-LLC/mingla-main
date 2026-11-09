/**
 * #4347 rework (P3-4) — one id per app launch. deckService stamps it on the
 * server's display-price fields as they arrive from a live deck response;
 * formatDisplayPrice trusts those fields only when the stamp matches, so a
 * copy persisted in Likes, the Calendar or a deck snapshot never reuses an
 * old conversion.
 */
export const LIVE_DISPLAY_PRICE_SESSION: string = `${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 10)}`;
