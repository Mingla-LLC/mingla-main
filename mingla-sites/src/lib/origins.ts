/**
 * #2830 — the Business web origin, the ONLY origin allowed to frame a private
 * preview. Mirrors `mingla-site-cms/src/lib/origins.ts`; the two apps deploy
 * separately, so each carries the constant and a test pins them equal.
 */
export const MINGLA_BUSINESS_ORIGIN = "https://host.usemingla.com";
