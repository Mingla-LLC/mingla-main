/**
 * #4334 — attach the picked Google place id to a saved event, venue listing or
 * brand (biz_set_location_place_id), right after the normal save RPC succeeds.
 * The id lets places-coordinate-refresh keep Google coordinates under the
 * 30-day cache limit; without it the row simply is not refreshed.
 *
 * Never blocks the save that already succeeded: a failure is reported to
 * Sentry (loud, not silent) and the row keeps its coordinates.
 */
import { reportNonFatal } from "../diagnostics/reportNonFatal";
import { supabase } from "./supabase";

export type LocationPlaceTarget = "event" | "venue_listing" | "brand";

const lastAttached = new Map<string, string | null>();

export async function attachLocationPlaceId(
  target: LocationPlaceTarget,
  rowId: string,
  placeId: string | null | undefined,
): Promise<void> {
  const id = typeof placeId === "string" && placeId.trim().length > 0 ? placeId.trim() : null;
  const key = `${target}:${rowId}`;
  if (lastAttached.has(key) && lastAttached.get(key) === id) return;
  const { error } = await supabase.rpc("biz_set_location_place_id", {
    p_target: target,
    p_row_id: rowId,
    p_place_id: id,
  });
  if (error !== null) {
    reportNonFatal("location_place_id", new Error(`attach_failed:${error.message}`), { target, rowId });
    return;
  }
  lastAttached.set(key, id);
}

/** Test-only. */
export function __resetAttachedPlaceIdsForTests(): void {
  lastAttached.clear();
}
