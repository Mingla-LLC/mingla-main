import { useMemo } from "react";

import {
  type CoverVideoSource,
  nativeCachedCoverSource,
} from "./coverVideoCache";

// META-ORCH-1270 Phase 3 (Vector A/C) — cover-video source hook, NATIVE variant
// (iOS/Android; Metro picks this over the .ts sibling on native). Returns the
// remote uri wrapped as a CACHED expo-video source (useCaching:true) so the player
// streams the clip once and replays it from expo-video's persistent, size-capped
// on-device LRU cache on every subsequent mount — killing the Finding-C per-open
// re-download and honouring the immutable / long-max-age delivery header.
//
// The source is only ATTACHED to the player when the cover is meant to play
// (EventCoverNativeVideo's source-defer), so a paused / off-screen / grid cover
// still fetches zero bytes; the cache only ever fills on a legitimate play.
export function useCachedCoverVideoUri(
  remoteUri: string | null | undefined,
): CoverVideoSource {
  return useMemo(() => nativeCachedCoverSource(remoteUri), [remoteUri]);
}
