import { useMemo } from "react";

import { type CoverVideoSource, webCoverSource } from "./coverVideoCache";

// META-ORCH-1270 Phase 3 (Vector A/C) — cover-video source hook, WEB / default
// variant. On web the browser's HTTP cache already reuses the clip across mounts,
// so this is a passthrough of the remote uri (no app-managed cache). The NATIVE
// sibling (useCachedCoverVideoUri.native.ts) wraps the uri with expo-video's
// persistent on-device cache flag. Metro resolves the platform file automatically;
// TypeScript follows THIS default for types — both variants share the
// CoverVideoSource return type and identical signature, so callers never branch.
//
// The result is only ever ATTACHED to the player when the cover is meant to play
// (EventCoverMedia's native source-defer), so a paused / off-screen / grid cover
// fetches zero bytes regardless of platform.
export function useCachedCoverVideoUri(
  remoteUri: string | null | undefined,
): CoverVideoSource {
  return useMemo(() => webCoverSource(remoteUri), [remoteUri]);
}
