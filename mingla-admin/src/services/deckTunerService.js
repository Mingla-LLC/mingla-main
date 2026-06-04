/**
 * ORCH-1066 — deck score tuner data service (standalone tuner page).
 *
 * Re-exports the 4 place-keyed tuner fns from adminClaimsService (no duplication)
 * PLUS the read fetchers the standalone page needs: servable-venue search, the
 * place's full per-signal score list, the active-signal catalog, and the
 * card-preview place fields.
 */

import { supabase } from "../lib/supabase";

export {
  scorePlacePreview,
  setPlaceSignalScore,
  pinPlaceToTop,
  getPlaceDeckRank,
} from "./adminClaimsService";

/**
 * The card-preview + tuner-relevant place_pool projection.
 * @typedef {Object} TunerPlaceData
 * @property {string} id
 * @property {string} name
 * @property {string[]|null} stored_photo_urls
 * @property {number|null} rating
 * @property {string|null} price_level
 * @property {unknown} price_tiers
 * @property {string|null} generative_summary
 * @property {string|null} primary_type
 * @property {string[]|null} types
 * @property {number|null} lat
 * @property {number|null} lng
 * @property {boolean} is_servable
 * @property {boolean} is_active
 */

const TUNER_PLACE_SELECT =
  "id, name, stored_photo_urls, rating, price_level, price_tiers, generative_summary, " +
  "primary_type, types, lat, lng, is_servable, is_active, address, city";

/**
 * Search servable (already-live) venues by name or address. Standalone tuner
 * only tunes LIVE venues → its preview/rank are real (non-projected). Pending
 * non-servable venues are tuned in the Claims modal.
 * @param {string} query
 * @param {number} [limit] default 20
 * @returns {Promise<Array<TunerPlaceData>>}
 */
export async function searchServableVenues(query, limit = 20) {
  const q = (query ?? "").trim();
  if (q.length === 0) return [];
  const { data, error } = await supabase
    .from("place_pool")
    .select(TUNER_PLACE_SELECT)
    .eq("is_servable", true)
    .or(`name.ilike.%${q}%,address.ilike.%${q}%`)
    .order("name", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * The card-preview place fields for one venue.
 * @param {string} placePoolId
 * @returns {Promise<TunerPlaceData|null>}
 */
export async function getPlacePreviewCard(placePoolId) {
  const { data, error } = await supabase
    .from("place_pool")
    .select(TUNER_PLACE_SELECT)
    .eq("id", placePoolId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * All active signals with their human labels (the 16-signal catalog), so the
 * tuner can render a dial for every signal even when the place has no score row.
 * @returns {Promise<Array<{ id: string, label: string }>>}
 */
export async function getActiveSignals() {
  const { data, error } = await supabase
    .from("signal_definitions")
    .select("id, label")
    .eq("is_active", true)
    .order("label", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * The committed place_scores for a place across all signals.
 * @param {string} placePoolId
 * @returns {Promise<Array<{ signal_id: string, score: number, contributions: unknown, scored_at: string }>>}
 */
export async function getPlaceScores(placePoolId) {
  const { data, error } = await supabase
    .from("place_scores")
    .select("signal_id, score, contributions, scored_at")
    .eq("place_id", placePoolId)
    .order("score", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
