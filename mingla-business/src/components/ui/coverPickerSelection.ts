/**
 * coverPickerSelection — META-ORCH-1059 [cover picker selected-state].
 *
 * Pure, dependency-free selection logic shared by the unified CoverPicker
 * (events / trips / experiences / brand). Extracted into its own module so the
 * "which grid tile is the current cover" rule can be unit-tested headlessly —
 * CoverPicker.tsx itself pulls heavy native deps (expo-video, expo-image-picker,
 * react-native-video-trim) that the jest environment cannot render.
 *
 * Matching is by APPLIED media URL. Tapping a GIF / Pexels / Library tile emits
 * a CoverPatch whose `coverMediaUrl` is the applied (full-size) URL; the grid
 * compares each candidate's applied URL against it so exactly one tile shows the
 * persistent SELECTED treatment (accent border + checkmark) while the sheet
 * stays open in the browse-then-confirm model.
 */

/**
 * True iff the current cover URL is the same non-empty URL as the candidate.
 * Null / empty on either side is never a match (no cover selected, or a tile
 * with no resolvable media).
 */
export const coverMediaMatches = (
  currentCoverUrl: string | null,
  candidateUrl: string | null,
): boolean => {
  if (currentCoverUrl === null || candidateUrl === null) return false;
  if (currentCoverUrl.length === 0 || candidateUrl.length === 0) return false;
  return currentCoverUrl === candidateUrl;
};

/**
 * Find the id of the provider result whose applied media URL is the current
 * cover, scoped by provider so a giphy URL can never light up a pexels tile and
 * vice-versa. Returns null when nothing matches.
 */
export const findSelectedProviderId = <Id extends string | number>(
  currentCoverUrl: string | null,
  currentProvider: string | null,
  provider: string,
  results: ReadonlyArray<{ id: Id; mediaUrl: string }>,
): Id | null => {
  if (currentProvider !== provider) return null;
  const hit = results.find((r) => coverMediaMatches(currentCoverUrl, r.mediaUrl));
  return hit ? hit.id : null;
};
