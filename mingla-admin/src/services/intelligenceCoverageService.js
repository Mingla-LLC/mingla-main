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
