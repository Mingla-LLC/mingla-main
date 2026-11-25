// #4490 — Admin read of a venue's features: the guard-first
// `admin_venue_features` definer RPC (admin only, STABLE, no writes).
//
// A SEPARATE file from `venuesService.js` on purpose: that file is held
// read-only by the Offerings console gate (I-PROPOSED-1273-OFFERINGS-READ-ONLY) and names only its
// own RPC list. This read adds no write path anywhere.
import { supabase } from "../lib/supabase";

/** The venue's features and the guest page payload. Throws on error. */
export async function getAdminVenueFeatures(venueId) {
  const { data, error } = await supabase.rpc("admin_venue_features", { p_venue_id: venueId });
  if (error) throw new Error(error.message || "Failed to load this venue's features.");
  return data ?? null;
}
