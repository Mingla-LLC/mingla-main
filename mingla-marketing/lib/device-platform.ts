// ORCH-1319 — shared device-platform detection.
//
// `isIosDevice` / `resolvePlatform` / `detectClientPlatform` are extracted
// VERBATIM (no behavior drift) from the now-deleted explorer lead modal so the
// reviewed detection survives the modal's deletion and is shared by the nav
// (client) and the /download route (server, UA-only). A unit test pins the
// iPad-as-Mac / Android / desktop cases against the originals.

// 3-way platform. 'other' = desktop / anything non-mobile-Apple and non-Android,
// so desktop NEVER resolves to iOS or Android.
export type Platform = 'ios' | 'android' | 'other'

/** True for iPhone / iPad (incl. iPadOS reporting a desktop "MacIntel" UA). */
export function isIosDevice(
  ua: string,
  platform: string,
  maxTouchPoints: number,
): boolean {
  // Classic iOS UA.
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ Safari masquerades as desktop Mac: platform "MacIntel" +
  // a touch screen (maxTouchPoints > 1) ⇒ it is an iPad, not a Mac.
  if (platform === 'MacIntel' && maxTouchPoints > 1) return true
  return false
}

/**
 * Resolve a 3-way platform from UA + platform + touch points. iOS wins first (an
 * iPad masquerading as Mac is still iOS); then Android by UA; everything else
 * (desktop incl. real Macs, Windows, Linux, ChromeOS) is 'other'.
 */
export function resolvePlatform(
  ua: string,
  platform: string,
  maxTouchPoints: number,
): Platform {
  if (isIosDevice(ua, platform, maxTouchPoints)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'other'
}

/** SSR-safe client platform read (never touches navigator at module load). */
export function detectClientPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  return resolvePlatform(
    navigator.userAgent ?? '',
    navigator.platform ?? '',
    navigator.maxTouchPoints ?? 0,
  )
}

/**
 * SERVER variant — UA-string-only (there is no `navigator.platform` /
 * `maxTouchPoints` server-side). iOS if the UA carries an iPad/iPhone/iPod token;
 * else Android by UA; else 'other'.
 *
 * Documented caveat: iPadOS 13+ Safari sends a desktop-Mac UA with NO `iPad`
 * token, so server-side an iPad resolves to 'other' and lands on the desktop QR
 * page — a SAFE fallback that still shows the App Store badge. The client nav
 * path still catches iPad via `maxTouchPoints`.
 */
export function resolvePlatformFromUa(ua: string): Platform {
  if (/iPad|iPhone|iPod/i.test(ua)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'other'
}
