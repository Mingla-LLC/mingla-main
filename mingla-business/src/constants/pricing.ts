/**
 * ORCH-1006 [Universal all-in pricing engine] — client-side pricing constants.
 *
 * These mirror the SERVER defaults so the authoring-time preview matches what
 * the engine will charge. The server (`_shared/allInPricingEngine.ts` +
 * `resolve_effective_take_rate_bps`) remains the single source of truth; if a
 * brand has a take-rate override or the platform default changes, the resolved
 * value flows in via `effectiveTakeRateBps` and overrides `DEFAULT_TAKE_RATE_BPS`.
 */

/** Launch default disclosed service fee, in bps. Mirrors engine `MINGLA_SERVICE_FEE_BPS` (300 = 3.00%). */
export const MINGLA_SERVICE_FEE_BPS = 300 as const;

/** Platform default take-rate (Mingla's cut), in bps. Seed = 150 (1.50%). Brand override wins. */
export const DEFAULT_TAKE_RATE_BPS = 150 as const;

/** The only pricing region enabled this ORCH (GB → inclusive VAT). */
export const PRICING_REGION_GB = "GB" as const;
export const PRICING_CURRENCY_GBP = "GBP" as const;
