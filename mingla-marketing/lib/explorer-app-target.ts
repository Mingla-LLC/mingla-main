// ORCH-1399 [links-src-tracking-getapp-stack] — the SINGLE source of truth for the
// EXPLORER (consumer) get-app decision. Mirrors lib/business-app-target.ts.
//
// WHY THIS MODULE EXISTS. The explorer store ternary
// `platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL` was copy-pasted across TWO
// call sites (glass-nav.tsx:69 and links-experience.tsx:214). That is the SAME
// triplication bug class ORCH-1381 killed for business — and it is exactly how the
// business Play listing going live left four surfaces stale at once. The explorer
// side simply had not bitten yet. ORCH-1399 kills it before it does.
//
// HARD CONSTRAINTS (do not relax):
//  - The install destination is the EXPLORER OneLink (go.usemingla.com/w36m) —
//    NEVER biz.usemingla.com (business-owned: 1 branded domain = 1 template,
//    ORCH-1346), and NEVER a raw *.onelink.me domain (routing policy: branded only).
//    A crossed link silently installs the WRONG app and poisons both apps'
//    attribution. Guarded by orch-1399-links-src-onelink-attribution.mjs (R1/R2) and
//    the onelink-never-crossed tester test (by identity, not substring).
//  - `attribution` is a REQUIRED parameter. See the note on the function below.
//
// React-free and pure, so it is importable by Server Components, Client Components,
// and a plain tsc+node test alike.

import type { Platform } from './device-platform'
import { buildOneLinkHref, type OneLinkAttribution } from './links-src'
import { EXPLORER_ONELINK_URL } from './store-links'

/** A native store the consumer app can be installed from (ANALYTICS LABEL ONLY). */
export type ExplorerInstallStore = 'app_store' | 'play'

export interface ExplorerAppTarget {
  /**
   * Where "Get the app" points. The OneLink is DEVICE-INDEPENDENT — AppsFlyer does
   * the per-device 301 server-side (Android → market://, iOS → apps.apple.com), which
   * is precisely what removes the intermediate store WEB page. `null` on desktop:
   * there is nothing to install, so the caller routes to the /download QR page.
   */
  installHref: string | null
  /**
   * Analytics label for the install action; `null` when there is no install action.
   *
   * DELIBERATELY PLATFORM-DERIVED even though `installHref` is now shared. It is a
   * LABEL, not a destination (mirrors business-app-target.ts). Keeping it derived is
   * what keeps the surfaces' `platform ===` branching genuinely load-bearing — so the
   * orch-1319 / orch-1328 device-driven checks stay meaningful instead of quietly
   * becoming decorative once the href stopped varying by device.
   */
  installStore: ExplorerInstallStore | null
  /** True iff the device can install a native consumer app (ios | android). */
  canInstall: boolean
}

/**
 * Resolve the explorer get-app destination for a device.
 *
 * ios     → the Explorer OneLink (301s to the App Store)  + 'app_store' label
 * android → the Explorer OneLink (301s to market://)      + 'play' label
 * other   → no install action (desktop routes to the /download QR page)
 *
 * WHY `attribution` IS REQUIRED AND NOT OPTIONAL. An optional param — or a separate
 * decorator each surface must remember to call — makes "forgot attribution" SILENT:
 * the CTA still works, the install still lands, and only the attribution is gone.
 * That is invisible in QA, invisible in CI, and surfaces months later as a hole in
 * reporting that cannot be backfilled. A required parameter makes it a COMPILE ERROR.
 * That is a stronger guard than any regex gate in this repo, and it costs one
 * signature.
 */
export function resolveExplorerAppTarget(
  platform: Platform,
  attribution: OneLinkAttribution,
): ExplorerAppTarget {
  if (platform === 'ios') {
    return {
      installHref: buildOneLinkHref(EXPLORER_ONELINK_URL, attribution),
      installStore: 'app_store',
      canInstall: true,
    }
  }
  if (platform === 'android') {
    return {
      installHref: buildOneLinkHref(EXPLORER_ONELINK_URL, attribution),
      installStore: 'play',
      canInstall: true,
    }
  }
  // Desktop / unknown / bot — nothing to install here. The caller opens /download.
  return {
    installHref: null,
    installStore: null,
    canInstall: false,
  }
}
