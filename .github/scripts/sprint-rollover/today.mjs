// ─────────────────────────────────────────────────────────────────────────────
// #1293 [sprint-rollover-tz-fix] — timezone-aware "today".
//
// REOPENED bug: the runner computed "today" from new Date().toISOString() = the UTC
// date. The board is operated in US Eastern; at UTC-midnight it is still the prior
// evening in Eastern, so a still-active sprint read as ENDED and 9 items rolled early.
//
// This is the ONLY source of "today" for the rollover. It resolves the calendar date
// in a configurable operating timezone (default America/New_York). Bare-date
// arithmetic downstream (selectMoves / computeEndISO) is timezone-independent and
// stays UNCHANGED — the defect was purely the date SOURCE.
//
// PURE + unit-testable: `now` is injectable so a fixed instant can be asserted.
//
// Node >= 20, ESM, built-ins only (Intl). No npm deps.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_ROLLOVER_TZ = "America/New_York";

/**
 * The calendar date ("YYYY-MM-DD") at instant `now`, as seen in timezone `tz`.
 *
 * Uses the en-CA locale, which formats as YYYY-MM-DD, evaluated in the target zone —
 * so 2026-07-28T02:46:00Z resolves to 2026-07-27 under America/New_York (22:46 EDT the
 * prior evening), not 2026-07-28.
 *
 * @param {string} [tz=DEFAULT_ROLLOVER_TZ] IANA timezone, e.g. "America/New_York".
 * @param {Date}   [now=new Date()]         instant to evaluate (injectable for tests).
 * @returns {string} "YYYY-MM-DD"
 */
export function todayISO(tz = DEFAULT_ROLLOVER_TZ, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export default todayISO;
