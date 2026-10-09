// #3682 Wave 2.3 — client mirror of supabase/functions/_shared/marketingBlastFollow.ts
// (composer preview). Keep copy / URL shape in lockstep with the edge helper.
// Canonical origin is hard-coded (same as the edge helper) so Jest and SSR do
// not depend on EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL for this append-only CTA.

const HOST_PUBLIC_ORIGIN = "https://host.usemingla.com";

export function brandFollowPublicUrl(brandSlug: string): string {
  const slug = brandSlug.trim();
  if (slug.length === 0) {
    throw new Error("brand_follow_slug_empty");
  }
  return `${HOST_PUBLIC_ORIGIN}/b/${encodeURIComponent(slug)}?intent=follow`;
}

export function appendSmsFollowLine(
  body: string,
  brandName: string,
  followUrl: string,
): string {
  const trimmed = body.replace(/\s+$/u, "");
  const name = brandName.trim().length > 0 ? brandName.trim() : "this brand";
  const line = `Follow ${name}: ${followUrl}`;
  if (trimmed.includes(followUrl)) return trimmed;
  return trimmed.length === 0 ? line : `${trimmed}\n\n${line}`;
}

/** Client mirror of edge `smsBlastBodyWithFollow` (composer preview + review). */
export function smsBlastBodyWithFollow(
  rawBody: string,
  brandName: string | null | undefined,
  brandSlug: string | null | undefined,
): string {
  const slug = typeof brandSlug === "string" ? brandSlug.trim() : "";
  if (slug.length === 0) return rawBody;
  const name =
    typeof brandName === "string" && brandName.trim().length > 0
      ? brandName.trim()
      : "this brand";
  return appendSmsFollowLine(rawBody, name, brandFollowPublicUrl(slug));
}
