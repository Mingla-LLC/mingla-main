/**
 * #4304 — media speed (C). On a phone, Brand-group photos are drawn through
 * expo-image with a stable cache key per file, so the second view of a photo
 * comes from memory or disk instead of the network. The edge function keeps
 * `private, no-store` on full files (#3720 contract) and the web keeps not
 * caching them; expo-image's native cache is keyed by `cacheKey`, never by the
 * signed request, so the bearer token is not part of what is stored.
 *
 * Thumb and full are separate entries: a 200 px poster must never be shown as
 * the full photo. Every entry is cleared on sign-out (brandGroupImageCache).
 *
 * Pure: no expo import.
 */

export type BrandGroupMediaVariant = "thumb" | "full";

export const BRAND_GROUP_MEDIA_CACHE_POLICY = "memory-disk" as const;

export function brandGroupMediaCacheKey(fileId: string, variant: BrandGroupMediaVariant): string {
  return `brand-group-file:${fileId}:${variant}`;
}
