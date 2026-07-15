// ORCH-1319 [Explorer "Get the app" → direct live-store links] — the single
// source of truth for the two LIVE public store listings. NEVER a TestFlight/beta
// URL. Later this may indirect through the AppsFlyer OneLink (ORCH-1313 P2) — the
// nav handler + /download route are the seam for that swap.

export const APP_STORE_URL = 'https://apps.apple.com/app/id6760440898'
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.mingla.app.v2'

// ORCH-1324 / ORCH-1381 [business get-app Android choice] — the two LIVE business
// store listings + the business web app origin. iOS → the business App Store;
// Android → the business Play listing; desktop/other → the business web app,
// whose root renders the owner get-started/sign-in screen.
// NEVER hardcode these inline in a component (mirrors the ORCH-1319 SSOT rule).
// The platform→destination decision lives ONLY in lib/business-app-target.ts.
export const BUSINESS_APP_STORE_URL = 'https://apps.apple.com/app/id6768737367'
export const BUSINESS_WEB_URL = 'https://business.usemingla.com'

// ORCH-1381 — the business Play listing is LIVE (production versionCode 33 /
// 1.1.2, status=completed, HTTP 200 — API-verified 2026-07-15, COMMS-0101).
// Business Android installs go to the PLAIN Play URL — NOT minglabiz.onelink.me,
// which is DEAD on Android (AppsFlyer app status Pending, COMMS-0101), and NEVER
// go.usemingla.com (consumer-owned OneLink, ORCH-1346).
export const BUSINESS_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness'
