/**
 * Issue #3258 — the brand's own public Mingla page, built in ONE place.
 *
 * `brands.slug` is `text NOT NULL` and immutable (trigger
 * `trg_brands_immutable_slug`, invariant I-17), and the canonical public brand
 * page is `{businessWebOrigin}/b/{slug}` — NOT `/{slug}`. That path was
 * already being concatenated by hand in three separate edge modules
 * (`_shared/adDestination.ts`, `_shared/email/claimApprovedEmail.ts`,
 * `marketing-send/index.ts`), and Stripe onboarding was about to become a
 * fourth. A wrong path here is not cosmetic: Stripe FETCHES the URL it is
 * given, and a 404 leaves `card_payments` at `pending` forever with
 * `disabled_reason = requirements.pending_verification` — the exact live
 * defect this issue was opened for.
 *
 * The origin is always passed IN. This module never reads `Deno.env` and never
 * carries a hardcoded host: callers already resolve the origin through
 * `_shared/businessWebOrigin.ts` (`resolveBusinessWebOrigin`) or their own
 * documented env chain, and duplicating that resolution here would create a
 * second source of truth for the same value.
 */

/** The public path for a brand page, slug-encoded. Never includes an origin. */
export function brandPublicPath(slug: string): string {
  return `/b/${encodeURIComponent(slug.trim())}`;
}

/**
 * `{origin}/b/{slug}`, with trailing slashes stripped off the origin and the
 * slug percent-encoded. Total: callers that have already proven both values
 * use this directly.
 */
export function buildBrandPublicUrl(input: {
  origin: string;
  slug: string;
}): string {
  const base = input.origin.trim().replace(/\/+$/, "");
  return `${base}${brandPublicPath(input.slug)}`;
}

/**
 * The guarded form, for callers holding values that may be absent.
 *
 * Returns `null` — never a half-built URL like `https://host.usemingla.com/b/`
 * — when either the origin or the slug is missing or blank. A caller that
 * sent a half-built URL to Stripe would hand it a page that cannot verify,
 * which is strictly worse than sending nothing at all (Constitution rule 9:
 * missing is hidden, never faked).
 */
export function resolveBrandPublicUrl(input: {
  origin: unknown;
  slug: unknown;
}): string | null {
  if (typeof input.origin !== "string" || input.origin.trim() === "") {
    return null;
  }
  if (typeof input.slug !== "string" || input.slug.trim() === "") {
    return null;
  }
  return buildBrandPublicUrl({ origin: input.origin, slug: input.slug });
}
