/**
 * Intelligence Coverage Estimators — ORCH-1008
 *
 * Pure cost/time math, no I/O. Extracted from intelligenceCoverageService so
 * the Node test runner (which can't resolve the supabase-js client at import
 * time) can exercise the math without booting the service.
 *
 * Gemini 2.5 Flash pricing reference: https://ai.google.dev/pricing/gemini-2-5-flash
 * (verified 2026-05-29 per COMMS-0003).
 */

/**
 * @param {number} remainingCount
 * @param {number} [perPlace=0.0040]
 * @returns {number} rounded to 4 dp
 */
export function estimateRemainderCostUsd(remainingCount, perPlace = 0.0040) {
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
