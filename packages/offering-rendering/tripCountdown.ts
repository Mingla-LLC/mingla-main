/**
 * tripCountdown — META-ORCH-1174 Leg A. Pure, RN-free helpers for the animated
 * <TripCountdownPill> (kept separate so the cadence + format logic is unit-tested
 * without a render). No side effects, no Date.now reads (callers pass `nowMs`).
 */

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * The tick cadence (ms) for a given remaining-ms, tightening as the deadline nears:
 *   ≥ 1 day  → hourly (3_600_000ms)
 *   ≥ 1 hour → minute (60_000ms)
 *   < 1 hour → second (1000ms)
 * Re-derived on every tick so the interval tightens automatically.
 */
export function countdownTickMs(remainingMs: number): number {
  if (remainingMs >= DAY) return HOUR;
  if (remainingMs >= HOUR) return MIN;
  return SEC;
}

/**
 * The live countdown label. Coarse granularity (drops seconds) when > 1 day to
 * avoid noise; the fine "Nd Nh Nm Ns" only inside the final hour. Returns null at
 * or past the deadline (the surface flips to the closed band via state).
 */
export function formatCountdown(deadlineMs: number, nowMs: number): string | null {
  const diff = deadlineMs - nowMs;
  if (diff <= 0) return null;

  const days = Math.floor(diff / DAY);
  const hours = Math.floor((diff % DAY) / HOUR);
  const minutes = Math.floor((diff % HOUR) / MIN);
  const seconds = Math.floor((diff % MIN) / SEC);

  if (diff >= DAY) {
    // coarse: days + hours only.
    return `Bookings close in ${days}d ${hours}h`;
  }
  if (diff >= HOUR) {
    return `Bookings close in ${hours}h ${minutes}m`;
  }
  // final hour — show the full minute/second tick.
  return `Bookings close in ${minutes}m ${seconds}s`;
}

/**
 * The static (reduce-motion) coarse label — a date, no ticking. Used when the OS
 * reduce-motion preference is on (accessibility parity, no per-second churn).
 */
export function formatDeadlineCoarse(deadlineIso: string): string | null {
  const ms = Date.parse(deadlineIso);
  if (!Number.isFinite(ms)) return null;
  try {
    return `Bookings close ${new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  } catch {
    return null;
  }
}
