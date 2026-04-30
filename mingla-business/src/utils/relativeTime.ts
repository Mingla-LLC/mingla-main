/**
 * Relative-time formatters — single source of truth for time display
 * across mingla-business.
 *
 * Lifted from inline copies in J-A9 BrandTeamView + J-A9
 * BrandMemberDetailView + J-A11 BrandPaymentsView during J-A12 Cycle-2
 * polish (D-INV-A10-3 watch-point THRESHOLD HIT 2026-04-30 at 3 inline
 * copies).
 *
 * DO NOT add ad-hoc `Date` / `Intl` calls for relative-time formatting
 * outside this file. If a future cycle needs a different bucket scheme
 * (e.g., minute-precision for activity feeds), extend this util with a
 * second function — do NOT inline a new formatter.
 */

/**
 * Format an ISO 8601 timestamp as a relative-time string.
 *
 * Output buckets:
 *   < 60s        → "just now"
 *   < 60m        → "{N}m ago"
 *   < 24h        → "{N}h ago"
 *   exactly 1d   → "yesterday"
 *   < 7d         → "{N}d ago"
 *   < 30d        → "{N}w ago"
 *   ≥ 30d        → "Mmm d" (e.g., "Apr 3")
 *
 * Negative diffs (timestamps in the future) clamp to "just now".
 *
 * @example formatRelativeTime(now - 5h) → "5h ago"
 * @example formatRelativeTime(now)      → "just now"
 */
export const formatRelativeTime = (iso: string): string => {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  });
};

/**
 * Format an ISO 8601 timestamp as "Mmm yyyy" (used for "Joined" labels).
 *
 * @example formatJoinedDate("2025-07-01T10:00:00Z") → "Jul 2025"
 */
export const formatJoinedDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
