/**
 * tripDuration — META-ORCH-1174 Leg A.3 [trip-page-fixes].
 *
 * THE ONE Hermes-safe trip date parser + "N days · M nights" duration deriver,
 * shared by BOTH per-surface adapters (business `tripOfferingAdapter` + consumer
 * `useConsumerTripOfferingData`) so the §3 dates pill and the §4 days&nights pill
 * compute identically on every surface — and, crucially, on NATIVE.
 *
 * ROOT CAUSE (device-reported bug #1): the canonical RPC `pg_public_trip_by_slug`
 * returns master dates as Postgres timestamp text with a SPACE separator and no
 * 'T' (e.g. "2026-08-17 00:00:00+00"). V8 (web/node) tolerantly parses this, but
 * Hermes (the React Native engine) follows the ES spec strictly and returns NaN
 * for the space-separated form → `formatTripDateRange` fell back to "Dates to be
 * set" and `deriveDuration` returned null (no days&nights pill). The bug was
 * therefore NATIVE-ONLY (web worked), which is why both native surfaces showed it.
 *
 * Fix: normalize to ISO-8601 (space→'T', a bare space-offset → '+') BEFORE
 * parsing. Pure (no app-src import — I-MOR-0827); no Date.now reads.
 */

/**
 * Normalize a backend timestamp string into a STRICT ISO-8601 form that BOTH
 * Hermes (React Native) AND V8 parse to the same instant:
 *   "2026-08-17 00:00:00+00"     → "2026-08-17T00:00:00+00:00"
 *   "2026-08-17 00:00:00.123+00" → "2026-08-17T00:00:00.123+00:00"
 *   "2026-08-17 00:00:00 +0000"  → "2026-08-17T00:00:00+00:00"
 *   "2026-08-17 00:00:00+05:30"  → "2026-08-17T00:00:00+05:30"  (already minutes)
 *
 * TWO defects are corrected, both of which Hermes rejects (NaN):
 *   1. the SPACE date↔time separator (Postgres) → 'T'.
 *   2. a bare-HOUR timezone offset "+00" / "-07" → "+00:00" / "-07:00". Note V8
 *      ALSO rejects the bare-hour offset WITH a 'T' ("...T00:00:00+00" → NaN), so
 *      expanding the offset is required for web parity too — NOT just Hermes.
 *
 * Already-strict ISO strings (with 'T' and a 'Z'/±HH:MM offset) pass through
 * untouched. Returns null for null/empty/whitespace (rule 9 — caller hides field).
 */
export function normalizeTimestampIso(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // 1) date↔time SPACE → 'T' (only the first space sits between date and time).
  let s = trimmed.replace(" ", "T");
  // 2) collapse a remaining space that precedes the timezone offset.
  s = s.replace(/\s+(?=[+-]\d{2}(?::?\d{2})?$|Z$)/, "");
  // 3) expand a BARE-HOUR trailing offset "+00"/"-07" → "+00:00"/"-07:00", and a
  //    compact "+0000" → "+00:00". A 'Z' or an already-"±HH:MM" offset is left as-is.
  s = s.replace(/([+-])(\d{2})$/, "$1$2:00"); // "+00"  → "+00:00"
  s = s.replace(/([+-])(\d{2})(\d{2})$/, "$1$2:$3"); // "+0000" → "+00:00"
  return s;
}

/**
 * Parse a backend timestamp (Hermes-safe) to epoch ms, or null when absent/invalid.
 */
export function parseTripTimestampMs(raw: string | null | undefined): number | null {
  const iso = normalizeTimestampIso(raw);
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Derive "N days · M nights" (or "N day") from a trip's start→end window, or null
 * when not derivable (rule 9 — never fabricated). Hermes-safe via the normalizer.
 */
export function deriveTripDuration(
  startAt: string | null,
  endAt: string | null,
): string | null {
  const s = parseTripTimestampMs(startAt);
  const e = parseTripTimestampMs(endAt);
  if (s === null || e === null || e < s) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const nights = Math.max(0, Math.round((e - s) / dayMs));
  const days = nights + 1;
  if (nights === 0) return `${days} day`;
  return `${days} days · ${nights} night${nights === 1 ? "" : "s"}`;
}
