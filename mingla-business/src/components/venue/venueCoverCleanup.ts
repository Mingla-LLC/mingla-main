export interface VenueCoverCleanupMedia {
  coverMediaUrl: string | null;
  coverMediaPosterUrl: string | null;
}

/**
 * Returns only superseded cover objects that no saved venue media still uses.
 * A photo can legitimately be both the hero and a gallery item, so replacing
 * the hero must not turn that gallery tile into a dangling storage URL.
 */
export function unreferencedPreviousCoverUrls(
  previous: VenueCoverCleanupMedia,
  next: VenueCoverCleanupMedia,
  galleryUrls: readonly string[],
): string[] {
  const retained = new Set<string>(galleryUrls);
  if (next.coverMediaUrl !== null) retained.add(next.coverMediaUrl);
  if (next.coverMediaPosterUrl !== null) retained.add(next.coverMediaPosterUrl);

  return [...new Set([previous.coverMediaUrl, previous.coverMediaPosterUrl])]
    .filter((url): url is string => url !== null && !retained.has(url));
}
