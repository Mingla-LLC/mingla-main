// N143 (#4490) — kept in its own tiny module: the order page route imports it
// at module scope and must not pull the cart rules into its chunk.
/**
 * N143 (#4490) — when the order page reads its status again. While a payment
 * is unpaid it backs off (5 s, 10 s, 20 s, then stops) and stops at once on a
 * declined / abandoned answer; the guest's own action (Try again, reload)
 * starts it over. Once paid, the kitchen progress keeps the steady interval.
 * null = do not read again.
 */
export function venueOrderStatusPollDelay(
  live: { paymentStatus: string; paymentCheck?: "confirmed" | "in_progress" | "not_paid" | null },
  pendingReadsSoFar: number,
  steadyMs: number,
): number | null {
  if (live.paymentStatus !== "pending") return steadyMs;
  if (live.paymentCheck === "not_paid") return null;
  return [5_000, 10_000, 20_000][pendingReadsSoFar] ?? null;
}
