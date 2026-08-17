/**
 * publicEventOccurrencesService — issue #2135 [multi-date public day picker].
 *
 * Anon-tolerant reader for the MATERIALISED occurrences of ONE published
 * event (`event_dates`), so the public event page can show a guest EVERY day
 * of a multi-date event instead of only the master row.
 *
 * Mirrors the experience read path EXACTLY (publicExperienceService
 * `loadExperienceSidecars`): a direct table read gated by the pre-existing anon
 * RLS policy — NOT a new RPC, NOT a migration:
 *   - event_dates : "Public can read event dates for published events
 *                    (anon or authenticated)"  (baseline squash, line 14436)
 *
 * Anon-tolerant per feedback_anon_buyer_routes.md: no useAuth, no sign-in
 * redirect — anyone with the share link sees every date.
 *
 * The returned row shape is DELIBERATELY the shape the SAME
 * `ExperienceReservePicker` (mode="slots") already renders, so there is one
 * occurrence-picker pattern in the codebase, not two. See `PublicEventOccurrence`
 * below for why it is declared here instead of aliased across services.
 *
 * `ticketsRemaining` is ALWAYS null here (Constitution #9 — missing is hidden,
 * never faked). `event_dates` carries NO per-occurrence capacity column and
 * ticket capacity is authored EVENT-level on `ticket_types.quantity_total`, so
 * there is no honest per-day remaining to publish: stamping the event-level
 * number onto each day would claim per-day availability that does not exist.
 * True independent per-day sell-out needs a schema change (a per-occurrence cap
 * + a per-occurrence sold count) — see the issue #2135 implementation report.
 *
 * Errors THROW (services throw on error — never `return []` on failure), so the
 * caller's React Query error state is real and the page never silently degrades
 * a multi-date event back to the single-date lie this issue is about.
 */

import { supabase } from "./supabase";

/**
 * One materialised `event_dates` row for a published event.
 *
 * This is declared here rather than aliased to the experience service's
 * `PublicExperienceDate`. That alias was the first thing written, and it closed
 * a REQUIRE CYCLE (I-PROPOSED-K): an *event* service importing from the
 * *experience* service completed
 * `usePublicEvents → publicEventOccurrencesService → publicExperienceService →
 * publicEventsService → … → usePublicEvents`. A public-event reader has no
 * business depending on the experience reader, so the dependency is gone rather
 * than baselined.
 *
 * The two shapes stay compatible BY COMPILATION, not by convention: this type is
 * what `MultiDateOccurrencePicker` hands to `ExperienceReservePicker`'s
 * `dates: ReadonlyArray<PublicExperienceDate>` prop, so tsc fails the moment
 * either side drifts. TypeScript is structural — no alias is required for that
 * guarantee, only for the (cyclic) import.
 */
export interface PublicEventOccurrence {
  /** `event_dates.id` — the value that rides through to `orders.event_date_id`. */
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
  isMaster: boolean;
  /** Always null here — see the file header (no per-occurrence capacity exists). */
  ticketsRemaining: number | null;
}

interface EventDateRow {
  id: string;
  start_at: string;
  end_at: string;
  timezone: string | null;
  is_master: boolean | null;
}

/**
 * Read every materialised occurrence of `eventId`, chronologically.
 *
 * Returns `[]` only when the event genuinely has no `event_dates` rows the
 * caller may read; an RLS/network failure throws.
 */
export const fetchPublicEventOccurrences = async (
  eventId: string,
  fallbackTimezone: string | null = null,
): Promise<PublicEventOccurrence[]> => {
  const { data, error } = await supabase
    .from("event_dates")
    .select("id, start_at, end_at, timezone, is_master")
    .eq("event_id", eventId)
    .order("start_at", { ascending: true });
  if (error !== null) throw error;
  const rows = (data ?? []) as EventDateRow[];
  return rows.map((row) => ({
    id: row.id,
    startAt: row.start_at,
    endAt: row.end_at,
    timezone:
      typeof row.timezone === "string" && row.timezone.length > 0
        ? row.timezone
        : (fallbackTimezone ?? "UTC"),
    isMaster: row.is_master === true,
    // See the file header: there is no per-occurrence capacity in the schema,
    // so there is no honest per-day remaining. NEVER fabricate one.
    ticketsRemaining: null,
  }));
};
