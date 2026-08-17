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
 * The returned row shape is DELIBERATELY the experience surface's
 * `PublicExperienceDate` (imported, not re-declared) so the SAME
 * `ExperienceReservePicker` (mode="slots") renders it with zero duplication —
 * one occurrence-picker pattern in the codebase, not two.
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
import type { PublicExperienceDate } from "./publicExperienceService";

/**
 * One materialised `event_dates` row for a published event, in the shared
 * occurrence shape the slots picker already consumes.
 */
export type PublicEventOccurrence = PublicExperienceDate;

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
