/**
 * Intelligence Coverage Estimators — ORCH-1008
 *
 * Pure cost/time math, no I/O. Extracted from intelligenceCoverageService so
 * the Node test runner (which can't resolve the supabase-js client at import
 * time) can exercise the math without booting the service.
 *
 * issue #3526 — the pricing citation and the RATE both moved out of this app.
 * The server owns the cost model and publishes it on `intelligence_coverage` /
 * `city_coverage`; see services/intelligenceCostModel.js for why there is no
 * fallback number anywhere on the client.
 */

/**
 * Pure arithmetic. It takes a rate; it does NOT own one.
 *
 * issue #3526 — the `= 0.0040` default is GONE. It was the fifth copy of a
 * number the edge function had already moved to 0.0089, and a caller that
 * omitted the argument silently priced a run at 45% of its real cost. There is
 * no safe default here: when the rate is unknown the honest answer is `null`,
 * not a confident wrong figure (Constitution #9).
 *
 * @param {number} remainingCount
 * @param {number} perPlace REQUIRED — from the server's cost_model.
 * @returns {number|null} rounded to 4 dp, or null when the rate is unknown
 */
export function estimateRemainderCostUsd(remainingCount, perPlace) {
  if (!Number.isFinite(perPlace) || perPlace <= 0) return null;
  if (!Number.isFinite(remainingCount) || remainingCount <= 0) return 0;
  return +(remainingCount * perPlace).toFixed(4);
}

/**
 * @param {number} remainingCount
 * @returns {number} whole minutes, rounded up at 30s/place
 */
export function estimateRemainderMinutes(remainingCount) {
  if (!Number.isFinite(remainingCount) || remainingCount <= 0) return 0;
  return Math.ceil((remainingCount * 30) / 60);
}
