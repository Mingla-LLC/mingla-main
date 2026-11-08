/**
 * #4304 — media speed (C), web. The browser build never stores Brand-group
 * media in expo-image's disk cache (full files are uncached on purpose and
 * thumbnails are object URLs revoked by MediaThumb), so there is nothing to
 * clear here. The native file clears expo-image's caches on sign-out.
 */
export async function clearBrandGroupImageCaches(): Promise<void> {
  return undefined;
}
