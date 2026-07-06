// ORCH-1319 [Explorer "Get the app" → direct live-store links] — the single
// source of truth for the two LIVE public store listings. NEVER a TestFlight/beta
// URL. Later this may indirect through the AppsFlyer OneLink (ORCH-1313 P2) — the
// nav handler + /download route are the seam for that swap.

export const APP_STORE_URL = 'https://apps.apple.com/app/id6760440898'
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.mingla.app.v2'
