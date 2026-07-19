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
//
// ORCH-1399 — these two PLAIN store URLs are NO LONGER the install destination for
// the business get-app CTAs: those now route through BUSINESS_ONELINK_URL below so
// the install is ATTRIBUTED. They remain the SSOT record of the two live business
// listings (pinned by the business-app-target tests, which assert the OneLink can
// never be cross-wired to a consumer listing), and the plain Play URL is what the
// OneLink itself resolves to on Android.
//
// STALE CLAIM CORRECTED (ORCH-1399 §0.1): the previous comment here stated
// minglabiz.onelink.me is "DEAD on Android (AppsFlyer app status Pending)". That is
// FALSE as of 2026-07-15 and was re-proven false by execution — under an Android UA
// the business OneLink returns 301 -> market://details/?id=com.sethogieva.minglabusiness
// on 5/5 consecutive attempts, and AppsFlyer MCP get_apps reports all 4 apps Active.
// The raw *.onelink.me domains stay BANNED, but on ROUTING POLICY (branded domains
// only, ORCH-1346), never on liveness. Do not re-derive a "dead OneLink" narrative.
export const BUSINESS_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness'

// ORCH-1399 [links-src-tracking-getapp-stack] — the AppsFlyer OneLink install
// destinations. This is the swap this file's own header anticipated ("Later this may
// indirect through the AppsFlyer OneLink (ORCH-1313 P2)").
//
// WHY THESE AND NOT THE PLAIN STORE URLs. A plain store URL returns HTTP 200 text/html,
// so Android renders the Play WEBSITE first and the user taps twice. The OneLink 301s
// straight to `market://`, which Chrome hands to the Play app with no web page in
// between — and it carries `pid`/`c` through to the Play install referrer, so the
// install is attributable. Proven by execution 2026-07-15 (5/5 per domain):
//   go.usemingla.com/w36m  -> 301 market://details/?id=com.mingla.app.v2
//   biz.usemingla.com/ZSCW -> 301 market://details/?id=com.sethogieva.minglabusiness
//   ?pid=bio_youtube&c=business_bio -> referrer=pid%3Dbio_youtube%26c%3Dbusiness_bio
//
// HARD RULE — NEVER CROSSED (ORCH-1346: one branded domain = one template):
//   Explorer/consumer -> go.usemingla.com  (template w36m  -> com.mingla.app.v2 / id6760440898)
//   Business          -> biz.usemingla.com (template ZSCW -> com.sethogieva.minglabusiness / id6768737367)
// Crossing them silently installs the WRONG app and poisons both apps' attribution.
// Enforced by orch-1399-links-src-onelink-attribution.mjs (R1/R2) + the
// onelink-never-crossed tester test. Never use the raw *.onelink.me domains.
export const EXPLORER_ONELINK_URL = 'https://go.usemingla.com/w36m'
export const BUSINESS_ONELINK_URL = 'https://biz.usemingla.com/ZSCW'
