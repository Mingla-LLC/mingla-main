// ORCH-1381 [business-getapp-android-choice] — the SINGLE source of truth for the
// business get-app decision: which store a device installs from, and the fact that
// every device can always fall back to the web dashboard.
//
// WHY THIS MODULE EXISTS. Before ORCH-1381 the ternary
// `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` was copy-pasted
// across FIVE call sites (nav, hero, /links, /host/download, and the native
// success screen). That triplication IS the bug class: when the business Play
// listing went live (2026-07-15, production versionCode 33 / 1.1.2 — COMMS-0101),
// four surfaces silently stayed stale and every Android owner was denied the app.
// The decision now lives HERE and nowhere else — one store going live is one edit.
//
// ORCH-1399 [links-src-tracking-getapp-stack] — the install destination is now the
// BUSINESS ONELINK, not the plain store URLs. WHY: a plain store URL returns HTTP 200
// text/html, so Android renders the Play WEBSITE first (the "intermediate page"
// complaint) and the install arrives ANONYMOUS. The OneLink 301s straight to
// market:// and carries pid/c into the Play install referrer. The plain store consts
// remain the SSOT record of the listings and are what the OneLink itself resolves to.
//
// HARD CONSTRAINTS (do not relax):
//  - Business installs resolve to BUSINESS_ONELINK_URL (biz.usemingla.com).
//    NEVER go.usemingla.com — that is the CONSUMER-owned branded domain (1 branded
//    domain = 1 template, ORCH-1346); crossing them ships business owners the
//    consumer Explorer app and poisons both apps' attribution. NEVER a raw
//    *.onelink.me domain — banned on ROUTING POLICY (branded domains only).
//    NOTE: the raw ban is NOT because the OneLink is dead. The old "minglabiz
//    OneLink is DEAD on Android (AppsFlyer Pending, COMMS-0101)" claim is STALE and
//    was re-proven false by execution 2026-07-15: 5/5 Android-UA attempts returned
//    301 -> market://details/?id=com.sethogieva.minglabusiness, and AppsFlyer reports
//    all 4 apps Active. Do not re-derive a "dead OneLink" narrative from old comments.
//  - Android must NEVER resolve `installHref` to BUSINESS_WEB_URL. That is the
//    exact bug ORCH-1381 killed (guarded by the fails-on-revert test T-1 and the
//    orch-1381 strict-grep gate).
//
// React-free and pure, so it is importable by the /host/download Server
// Component, the three Client Components, and a plain tsc+node test alike.

import type { Platform } from './device-platform'
import { buildOneLinkHref, type OneLinkAttribution } from './links-src'
import { BUSINESS_ONELINK_URL, BUSINESS_WEB_URL } from './store-links'

/** A native store a business owner can install the app from. */
export type BusinessInstallStore = 'app_store' | 'play'

/** Every destination a business get-app action can resolve to (analytics label). */
export type BusinessActionStore = BusinessInstallStore | 'business_web'

export interface BusinessAppTarget {
  /**
   * Where "Get the app" points — the BUSINESS OneLink, which 301s per device
   * (Android → market://, iOS → apps.apple.com) with attribution attached.
   * `null` on desktop/unknown — nothing to install.
   */
  installHref: string | null
  /**
   * Analytics label for the install action; `null` when there is no install action.
   *
   * DELIBERATELY PLATFORM-DERIVED even though `installHref` is now shared across
   * ios/android. It is a LABEL, not a destination — and keeping it derived is what
   * keeps each surface's `platform ===` branching genuinely load-bearing, so the
   * orch-1324 device-aware checks stay meaningful rather than becoming decorative.
   */
  installStore: BusinessInstallStore | null
  /** Where "Use on web" points. ALWAYS present — every device can use the web. */
  webHref: string
  /** True iff the device can install a native business app (ios | android). */
  canInstall: boolean
}

/**
 * Resolve the business get-app destinations for a device.
 *
 * ios     → the business OneLink (301s to the business App Store) + web fallback
 * android → the business OneLink (301s to market://)              + web fallback
 * other   → web only (desktop has nothing to install; no dead install button)
 *
 * WHY `attribution` IS REQUIRED AND NOT OPTIONAL (ORCH-1399). An optional param — or
 * a separate decorator the 4 surfaces must remember to call — makes "forgot
 * attribution" SILENT: the CTA still works, the install still lands, and only the
 * attribution is gone. Invisible in QA, invisible in CI, discovered months later as a
 * hole in reporting that cannot be backfilled. A required parameter makes it a
 * COMPILE ERROR at every call site. That is a stronger guard than any regex gate
 * here, and it costs one signature.
 */
export function resolveBusinessAppTarget(
  platform: Platform,
  attribution: OneLinkAttribution,
): BusinessAppTarget {
  if (platform === 'ios') {
    return {
      installHref: buildOneLinkHref(BUSINESS_ONELINK_URL, attribution),
      installStore: 'app_store',
      webHref: BUSINESS_WEB_URL,
      canInstall: true,
    }
  }
  if (platform === 'android') {
    return {
      installHref: buildOneLinkHref(BUSINESS_ONELINK_URL, attribution),
      installStore: 'play',
      webHref: BUSINESS_WEB_URL,
      canInstall: true,
    }
  }
  // Desktop / unknown / bot — nothing to install here.
  return {
    installHref: null,
    installStore: null,
    webHref: BUSINESS_WEB_URL,
    canInstall: false,
  }
}

/**
 * The business get-app copy. Every claim below is CODE-VERIFIED (SPEC §5) — do not
 * widen it:
 *  - "scan tickets at the door" — scanTicket() (the edge fn that actually validates
 *    and burns a ticket) has exactly ONE call site, in the NATIVE scanner screen;
 *    the web twin imports it zero times and already tells owners door scanning is
 *    app-only. Web CAN mark a name off a device-local list, so this says "scan
 *    tickets", NEVER "check guests in".
 *  - "get push alerts" — the business web OneSignal service is a no-op shim with no
 *    web-push fallback. Delivery is native-only; the notification CENTRE works on
 *    web, so this says "get push alerts", NEVER "see your notifications".
 *  - "Everything else works on the web too" — deliberate. The app does NOT do
 *    everything: Stripe Connect payouts onboarding is WEB-ONLY. Never escalate this
 *    into app-superiority.
 */
export const BUSINESS_APP_CHOICE_COPY = {
  // ORCH-1399 — "Download the app" → "Get the app": matches the nav's existing
  // wording and its get_the_app_clicked event name. All 4 surfaces render this
  // constant, so all 4 update from this ONE line — the structural pin working as
  // designed. Never hand-write the label at a surface.
  download: 'Get the app',
  useWeb: 'Use on web',
  // Phone (ios | android) — both actions are live.
  moreNote:
    'The app does more: scan tickets at the door and get push alerts. Everything else works on the web too.',
  // Desktop / unknown — nothing to install here.
  desktopNote:
    'The app is on iPhone and Android — scan tickets at the door, get push alerts. On a computer, use the web dashboard.',
} as const
