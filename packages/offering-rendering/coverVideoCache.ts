// META-ORCH-1270 Phase 3 (Vector A/C) — native cover-video source resolution.
//
// Pure, dependency-free helpers that decide the VIDEO SOURCE handed to the native
// player. Kept RN-free and import-free (I-MOR-0827-PACKAGE-ISOLATION) so the
// leak-critical behaviour is unit-testable without a renderer or a native module.
// The platform hooks (useCachedCoverVideoUri.ts / .native.ts) wrap these.

// A source shape accepted by expo-video's `player.replaceAsync` (a subset of its
// VideoSource): a bare url (web / uncached), a url + on-device cache flag
// (native), or null (no source → nothing is fetched).
export type CoverVideoSource =
  | string
  | { uri: string; useCaching: boolean }
  | null;

// NATIVE: attach the remote uri WITH expo-video's persistent on-device cache
// enabled (Finding C). expo-video keeps a size-capped LRU disk cache keyed on the
// url, so re-opening a screen replays the clip from disk instead of
// re-downloading — honouring Bunny/Cloudinary's immutable / long-max-age headers
// across remounts. A null / empty url yields null (no source, no bytes).
export function nativeCachedCoverSource(
  remoteUri: string | null | undefined,
): CoverVideoSource {
  if (typeof remoteUri !== "string" || remoteUri.length === 0) return null;
  return { uri: remoteUri, useCaching: true };
}

// WEB: the browser's HTTP cache already honours the response cache-control, so
// the source is the plain remote url (no app-managed cache layer). Empty → null.
export function webCoverSource(
  remoteUri: string | null | undefined,
): CoverVideoSource {
  if (typeof remoteUri !== "string" || remoteUri.length === 0) return null;
  return remoteUri;
}
