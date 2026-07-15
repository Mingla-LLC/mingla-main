// ORCH-1381 [business-getapp-android-choice] — the SINGLE source of truth for the
// business get-app decision: which store a device installs from, and the fact that
// every device can always fall back to the web dashboard.
//
// WHY THIS MODULE EXISTS. Before ORCH-1381 the ternary
// `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` was copy-pasted
// across FIVE call sites (nav, hero, /links, /business/download, and the native
// success screen). That triplication IS the bug class: when the business Play
// listing went live (2026-07-15, production versionCode 33 / 1.1.2 — COMMS-0101),
// four surfaces silently stayed stale and every Android owner was denied the app.
// The decision now lives HERE and nowhere else — one store going live is one edit.
//
// HARD CONSTRAINTS (do not relax):
//  - Android resolves to the PLAIN Play URL. NEVER minglabiz.onelink.me — that
//    OneLink is DEAD on Android (AppsFlyer app status Pending, COMMS-0101) and
//    would ship a broken install path. NEVER go.usemingla.com — it is
//    consumer-owned (1 branded domain = 1 template, ORCH-1346).
//  - Android must NEVER resolve `installHref` to BUSINESS_WEB_URL. That is the
//    exact bug this ORCH kills (guarded by the fails-on-revert test T-1 and the
//    orch-1381 strict-grep gate).
//
// React-free and pure, so it is importable by the /business/download Server
// Component, the three Client Components, and a plain tsc+node test alike.

import type { Platform } from './device-platform'
import {
  BUSINESS_APP_STORE_URL,
  BUSINESS_PLAY_STORE_URL,
  BUSINESS_WEB_URL,
} from './store-links'

/** A native store a business owner can install the app from. */
export type BusinessInstallStore = 'app_store' | 'play'

/** Every destination a business get-app action can resolve to (analytics label). */
export type BusinessActionStore = BusinessInstallStore | 'business_web'

export interface BusinessAppTarget {
  /** Where "Download the app" points. `null` on desktop/unknown — nothing to install. */
  installHref: string | null
  /** Analytics label for the install action; `null` when there is no install action. */
  installStore: BusinessInstallStore | null
  /** Where "Use on web" points. ALWAYS present — every device can use the web. */
  webHref: string
  /** True iff the device can install a native business app (ios | android). */
  canInstall: boolean
}

/**
 * Resolve the business get-app destinations for a device.
 *
 * ios     → the LIVE business App Store listing  + web fallback
 * android → the LIVE business Play listing       + web fallback
 * other   → web only (desktop has nothing to install; no dead install button)
 */
export function resolveBusinessAppTarget(platform: Platform): BusinessAppTarget {
  if (platform === 'ios') {
    return {
      installHref: BUSINESS_APP_STORE_URL,
      installStore: 'app_store',
      webHref: BUSINESS_WEB_URL,
      canInstall: true,
    }
  }
  if (platform === 'android') {
    return {
      installHref: BUSINESS_PLAY_STORE_URL,
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
  download: 'Download the app',
  useWeb: 'Use on web',
  // Phone (ios | android) — both actions are live.
  moreNote:
    'The app does more: scan tickets at the door and get push alerts. Everything else works on the web too.',
  // Desktop / unknown — nothing to install here.
  desktopNote:
    'The app is on iPhone and Android — scan tickets at the door, get push alerts. On a computer, use the web dashboard.',
} as const
