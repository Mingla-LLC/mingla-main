/**
 * Intelligence Coverage Service — ORCH-1008
 *
 * Single service that fetches per-city Intelligence Trial coverage for the
 * Intelligence Overview tab. Calls the run-place-intelligence-trial edge fn
 * with action='intelligence_coverage' (admin-gated; the edge fn enforces
 * admin_users.status='active' on the caller).
 *
 * Returns shape (per SPEC §3 Phase 3a + ORCH-1014 SPEC §3 Finding B.1):
 *
 *   Array<{
 *     city_id: string,
 *     city_name: string,
 *     country: string | null,
 *     servable_count: number,           // place_pool WHERE city_id=X AND is_servable=true
 *     evaluated_count: number,          // distinct place_pool_id from place_intelligence_trial_runs
 *                                       //   WHERE city_id=X AND status='completed'
 *     remaining_count: number,          // servable_count - evaluated_count (floor 0)
 *     coverage_pct: number,             // (evaluated/servable) * 100, 1dp; 0 if servable=0; clamped ≤100
 *     last_run_id: string | null,
 *     last_run_at: string | null,       // ISO timestamp of most recent terminal run
 *     last_run_status: string | null,   // 'complete' | 'failed' | 'cancelled'
 *     last_run_cost_usd: number | null,
 *     last_run_mode: string | null,     // 'sample' | 'full_city' | 'retry_failed' | 'remainder'
 *
 *     // ORCH-1014 — Seed status badge inputs (scope: ALL place_pool rows for this city,
 *     // servable + non-servable; operator mental model of "when was this city last seeded"
 *     // includes Bouncer rejects):
 *     first_seeded_at: string | null,   // ISO; MIN(place_pool.created_at) where city_id=X
 *     last_seeded_at:  string | null,   // ISO; MAX(place_pool.created_at) where city_id=X
 *
 *     // ORCH-1014 — Refresh status badge inputs (scope: is_servable=true only; operator
 *     // only cares about data that drives serving decisions). "Stale" = last_detail_refresh
 *     // older than 90 days (operator-chosen operational threshold, hardcoded in edge fn).
 *     refresh_oldest_at:     string | null,  // ISO; MIN(last_detail_refresh) where city_id=X AND is_servable=true
 *     refresh_newest_at:     string | null,  // ISO; MAX(last_detail_refresh) where city_id=X AND is_servable=true
 *     stale_refresh_count:   number,         // count where last_detail_refresh < NOW() - 90d (NULL counts as stale)
 *     missing_fields_count:  number,         // count where generative_summary IS NULL
 *                                            //   OR editorial_summary IS NULL
 *                                            //   OR reviews IS NULL OR jsonb_array_length(reviews) = 0
 *
 *     // ORCH-1015 — Boundary + Details binary readiness flags driving the
 *     // 3-band layout + smart-skip bulk button on IntelligenceOverviewTab.
 *     // Cutover date for `refreshed_new_fields` + `needs_refresh_count` is
 *     // 2026-03-19 (commit 596b3c05c, 48-field DETAIL_FIELD_MASK ship).
 *     // Hardcoded constant in the edge fn — not runtime-tunable.
 *     regeocoded:            boolean,        // seeding_cities.coverage_radius_km = 0
 *     refreshed_new_fields:  boolean,        // needs_refresh_count === 0 AND servable_count > 0
 *                                            //   (i.e. EVERY servable place refreshed post-cutover)
 *     needs_refresh_count:   number,         // COUNT(*) FILTER (is_servable AND
 *                                            //                  (last_detail_refresh < 2026-03-19 OR NULL))
 *                                            //   NULL counted as needing refresh (mirrors stale-NULL rule)
 *   }>
 *
 * Sorted by servable_count desc.
 *
 * Gemini 2.5 Flash pricing reference (for cost preview math):
 * https://ai.google.dev/pricing/gemini-2-5-flash (verified 2026-05-29).
 * COMMS-0003 — external API parameters/pricing must cite provider docs URL.
 */

import { invokeWithRefresh } from "../lib/supabase";
import { extractFunctionError } from "../lib/edgeFunctionError";

// Estimators live in a pure-math sibling so the Node test runner can exercise
// them without importing the supabase-js client.
export {
  estimateRemainderCostUsd,
  estimateRemainderMinutes,
} from "./intelligenceCoverageEstimators.js";

export async function fetchIntelligenceCoverage() {
  const { data, error } = await invokeWithRefresh("run-place-intelligence-trial", {
    body: { action: "intelligence_coverage" },
  });
  if (error) {
    throw new Error(await extractFunctionError(error, "intelligence_coverage failed"));
  }
  if (!data || !Array.isArray(data.rows)) {
    throw new Error("intelligence_coverage returned malformed payload");
  }
  return data.rows;
}
