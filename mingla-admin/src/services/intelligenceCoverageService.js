/**
 * Intelligence Coverage Service — ORCH-1008
 *
 * Single service that fetches per-city Intelligence Trial coverage for the
 * Intelligence Overview tab. Calls the run-place-intelligence-trial edge fn
 * with action='intelligence_coverage' (admin-gated; the edge fn enforces
 * admin_users.status='active' on the caller).
 *
 * Returns shape (per SPEC §3 Phase 3a):
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

/**
 * Estimated USD cost for a `remainder` run.
 *
 * @param {number} remainingCount - integer ≥0
 * @param {number} [perPlace=0.0040] - per-place rate; SPEC default matches the
 *   edge fn PER_PLACE_COST_USD constant. Override at the call site only when
 *   the operator has bumped the rate (COMMS-0003 — change both places at once).
 * @returns {number} - rounded to 4 dp
 */
export function estimateRemainderCostUsd(remainingCount, perPlace = 0.0040) {
  if (!Number.isFinite(remainingCount) || remainingCount <= 0) return 0;
  return +(remainingCount * perPlace).toFixed(4);
}

/**
 * Estimated wall-time minutes for a `remainder` run (server-side, ~30s per place).
 *
 * @param {number} remainingCount
 * @returns {number} - rounded UP to whole minutes
 */
export function estimateRemainderMinutes(remainingCount) {
  if (!Number.isFinite(remainingCount) || remainingCount <= 0) return 0;
  return Math.ceil((remainingCount * 30) / 60);
}
