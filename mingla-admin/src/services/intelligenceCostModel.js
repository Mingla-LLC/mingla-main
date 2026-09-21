/**
 * The per-place cost model — issue #3526 P0-1.
 *
 * WHY THIS FILE EXISTS, AND WHY IT HOLDS NO NUMBERS.
 *
 * The admin app used to keep FIVE independent copies of `PER_PLACE_COST_USD =
 * 0.0040` and decide `confirm_high_cost` from its own arithmetic. When the edge
 * function's rate moved to $0.0089 the two sides disagreed, and the
 * disagreement was not cosmetic: Baltimore, 1,205 places remaining, showed
 * "$4.82 — no confirmation needed", sent `confirm_high_cost: false`, and the
 * server computed $10.72 and returned HTTP 400 `cost_above_guard`.
 * `useBulkRunDispatcher` never retried with the flag, so the button could not
 * start that city at all.
 *
 * Constitution #2, one owner per truth: the SERVER owns the cost model. It
 * publishes it on the two read actions this app already calls
 * (`intelligence_coverage`, `city_coverage`) and the client renders what it is
 * told.
 *
 * THERE IS DELIBERATELY NO FALLBACK RATE IN THIS FILE. A client that guesses is
 * a client that owns the truth again, and a sixth copy of the number is exactly
 * what this change exists to remove. When the server has not said, the answer is
 * `null` — "unknown" — and the UI must show that rather than a confident wrong
 * figure. Constitution #9: missing is hidden, never faked. On a screen where
 * Seth authorises spend, an absent number is safe and a stale one is not.
 *
 * Strict-grep gate `i-3526-gemini-model-single-source.mjs` (G-5) fails any
 * non-test file under `mingla-admin/src` that puts a rate literal next to a
 * per-place-cost identifier.
 */

/**
 * Normalise the server's `cost_model` payload.
 * @returns {{perPlaceCostUsd:number, costGuardUsd:number,
 *   costDriftToleranceUsdPerPlace:number, pricingVersion:(string|null),
 *   pricingReferenceUrl:(string|null), modelId:(string|null)}|null}
 *   null when the server did not supply a usable model.
 */
export function normalizeCostModel(raw) {
  if (!raw || typeof raw !== "object") return null;
  const perPlaceCostUsd = Number(raw.per_place_cost_usd);
  const costGuardUsd = Number(raw.cost_guard_usd);
  // Both must be present and sane. A zero or negative rate is not a cost model,
  // it is a bug, and pricing a run at $0 would defeat the guard entirely.
  if (!Number.isFinite(perPlaceCostUsd) || perPlaceCostUsd <= 0) return null;
  if (!Number.isFinite(costGuardUsd) || costGuardUsd <= 0) return null;
  const drift = Number(raw.cost_drift_tolerance_usd_per_place);
  return {
    perPlaceCostUsd,
    costGuardUsd,
    // Derived server-side as a FRACTION of the rate. The admin previously
    // hardcoded 0.001 described as "±25% of $0.0040", so it silently became
    // ±11% when the rate moved and the drift badge would have fired on every run.
    costDriftToleranceUsdPerPlace:
      Number.isFinite(drift) && drift > 0 ? drift : perPlaceCostUsd * 0.25,
    pricingVersion: typeof raw.pricing_version === "string" ? raw.pricing_version : null,
    pricingReferenceUrl:
      typeof raw.pricing_reference_url === "string" ? raw.pricing_reference_url : null,
    modelId: typeof raw.model_id === "string" ? raw.model_id : null,
  };
}

/**
 * Estimated cost of running `count` places.
 * @returns {number|null} null when the cost model is unknown.
 */
export function estimateCostUsd(count, costModel) {
  if (!costModel) return null;
  if (!Number.isFinite(count) || count <= 0) return 0;
  return +(count * costModel.perPlaceCostUsd).toFixed(4);
}

/**
 * Does this run need `confirm_high_cost: true`?
 *
 * Mirrors the server's `estCost > COST_GUARD_USD` using the SERVER's own two
 * numbers, so the two sides cannot disagree the way they did on Baltimore.
 * @returns {boolean|null} null when the cost model is unknown — in which case
 *   the caller must not start the run, because it cannot price it.
 */
export function needsHighCostConfirmation(count, costModel) {
  const est = estimateCostUsd(count, costModel);
  if (est === null) return null;
  return est > costModel.costGuardUsd;
}

/** Human-facing rate, e.g. "$0.0089". Null when unknown. */
export function formatPerPlaceCost(costModel) {
  if (!costModel) return null;
  return `$${costModel.perPlaceCostUsd.toFixed(4)}`;
}
