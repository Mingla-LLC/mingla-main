/**
 * #4304 part 3 — "has this host ever made anything?" for the First Home gate.
 *
 * Two tiny existence probes over the host's own brands (RLS-scoped to the
 * caller): any `events` row (events, experiences, RSVPs and trips all live
 * there, drafts included) or any `venue_listings` row. No `deleted_at` filter
 * on purpose: once something was made, Home has appeared, and a later delete
 * must not take it away (it also re-derives the unlock after a sign-out
 * cleared the local flag).
 *
 * Throws on error (the hook keeps "pending" and the normal tabs) — never
 * returns a fabricated "no content".
 */

import { supabase } from "./supabase";
import { DATA_FETCH_TIMEOUT_MS, withTimeout } from "../utils/withTimeout";

export async function brandsHaveAnyContent(
  brandIds: readonly string[],
): Promise<boolean> {
  if (brandIds.length === 0) return false;
  const ids = [...brandIds];
  const [eventsResult, venuesResult] = await Promise.all([
    withTimeout(
      supabase
        // orch-strict-grep-allow events-type-filter — #4304 existence probe: ANY offering kind (event, experience, RSVP, trip) unlocks Home, so no event_type filter by design; only `id` is read.
        .from("events")
        .select("id")
        .in("brand_id", ids)
        .limit(1),
      DATA_FETCH_TIMEOUT_MS,
      "brandsHaveAnyContent:events",
    ),
    withTimeout(
      supabase
        .from("venue_listings")
        .select("id")
        .in("brand_id", ids)
        .limit(1),
      DATA_FETCH_TIMEOUT_MS,
      "brandsHaveAnyContent:venues",
    ),
  ]);
  if (eventsResult.error) throw eventsResult.error;
  if (venuesResult.error) throw venuesResult.error;
  return (
    (eventsResult.data ?? []).length > 0 || (venuesResult.data ?? []).length > 0
  );
}
