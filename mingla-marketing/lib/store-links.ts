// ORCH-1319 [Explorer "Get the app" → direct live-store links] — the single
// source of truth for the two LIVE public store listings. NEVER a TestFlight/beta
// URL. Later this may indirect through the AppsFlyer OneLink (ORCH-1313 P2) — the
// nav handler + /download route are the seam for that swap.

export const APP_STORE_URL = 'https://apps.apple.com/app/id6760440898'
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.mingla.app.v2'

// ORCH-1324 [business "Get the app" → device-aware] — the LIVE business App Store
// listing + the business web app origin. iOS → the business App Store; Android
// (Google Play still in review — no Play listing yet) + desktop/other → the
// business web app, whose root renders the owner get-started/sign-in screen.
// NEVER hardcode these inline in a component (mirrors the ORCH-1319 SSOT rule).
export const BUSINESS_APP_STORE_URL = 'https://apps.apple.com/app/id6768737367'
export const BUSINESS_WEB_URL = 'https://business.usemingla.com'
