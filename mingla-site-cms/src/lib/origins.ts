export const MINGLA_BUSINESS_ORIGIN = "https://host.usemingla.com";

/**
 * #2829 W9f — a Business web Vercel preview deployment that frames Studio's
 * preview page passes its own origin as `fa`; Studio forwards it to the
 * runtime's /preview, which adds that one exact origin to frame-ancestors.
 * Mirrors mingla-sites/src/lib/origins.ts (a test pins the two equal).
 */
export const BUSINESS_PREVIEW_ORIGIN_PATTERN =
  /^https:\/\/mingla-business-[a-z0-9-]+\.vercel\.app$/;

export function businessPreviewFrameAncestor(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length <= 200 &&
      BUSINESS_PREVIEW_ORIGIN_PATTERN.test(value)
    ? value
    : null;
}
