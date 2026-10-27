/**
 * #2830 — the Business web origin, the ONLY origin allowed to frame a private
 * preview. Mirrors `mingla-site-cms/src/lib/origins.ts`; the two apps deploy
 * separately, so each carries the constant and a test pins them equal.
 */
export const MINGLA_BUSINESS_ORIGIN = "https://host.usemingla.com";

/**
 * #2829 W9f — Mingla Studio frames the private preview in its own preview
 * page (PreviewChrome), so the runtime's /preview must allow it as an
 * ancestor; without it the Studio preview was blank (production too).
 */
export const MINGLA_STUDIO_ORIGIN = "https://studio.sites.usemingla.com";

/**
 * #2829 W9f — a Business web Vercel preview deployment (the same pattern
 * supabase/functions/_shared/businessWebOrigin.ts accepts). CSP cannot express
 * this pattern, so a preview deployment names itself with `?fa=<origin>` and
 * the runtime adds that ONE exact origin when, and only when, it matches.
 */
export const BUSINESS_PREVIEW_ORIGIN_PATTERN =
  /^https:\/\/mingla-business-[a-z0-9-]+\.vercel\.app$/;

export function businessPreviewFrameAncestor(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length <= 200 &&
      BUSINESS_PREVIEW_ORIGIN_PATTERN.test(value)
    ? value
    : null;
}
