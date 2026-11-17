/**
 * #4459 design v2 — the Guest chat rate limit (the server allows a guest 20
 * messages per rolling 10 minutes and answers PT409 rate_limited past that).
 * When it trips, the composer shows an amber notice with a live countdown,
 * Send is held and the typed text stays.
 *
 * Pure (no React Native) so it runs under Deno.
 */
export const BRAND_GUEST_RATE_MAX = 20;
export const BRAND_GUEST_RATE_WINDOW_MS = 10 * 60 * 1000;
/** With nothing local to count from, try again after a minute. */
export const BRAND_GUEST_RATE_FALLBACK_MS = 60 * 1000;

/**
 * When the guest may post again: the oldest of their sends inside the window
 * leaves it. `sentAt` is the guest's own confirmed sends in this chat.
 */
export function brandGuestRateLimitedUntil(sentAt: readonly string[], now: number): number {
  const inWindow = sentAt
    .map((iso) => Date.parse(iso))
    .filter((time) => Number.isFinite(time) && time > now - BRAND_GUEST_RATE_WINDOW_MS)
    .sort((a, b) => a - b);
  if (inWindow.length >= BRAND_GUEST_RATE_MAX) {
    const oldestThatCounts = inWindow[inWindow.length - BRAND_GUEST_RATE_MAX];
    return Math.max(oldestThatCounts + BRAND_GUEST_RATE_WINDOW_MS, now + 1000);
  }
  return now + BRAND_GUEST_RATE_FALLBACK_MS;
}

/** Seconds left, as "m:ss" (never negative). */
export function formatRateCountdown(untilMs: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((untilMs - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function isRateLimited(untilMs: number | null | undefined, now: number): boolean {
  return typeof untilMs === "number" && untilMs > now;
}
