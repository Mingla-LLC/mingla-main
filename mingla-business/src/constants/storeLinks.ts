/**
 * storeLinks — ORCH-1342 [web-see-whos-going-funnel] (META-ORCH-1337 Leg 5,
 * SPEC §4.1).
 *
 * THE mingla-business single source of truth for the LIVE public consumer
 * store listings + the marketing smart-download page. NEVER hardcode a store
 * URL (or the OneLink branded domain) in a component — import from here
 * (the ORCH-1319/1324 SSOT rule, extended to mingla-business; retires the
 * F-12 stale `apps.apple.com/app/mingla` CTA URL).
 *
 * DRIFT GATE (I-PROPOSED-1342-STORE-LINKS-SSOT):
 * `.github/scripts/strict-grep/orch-1342-store-links-ssot.mjs` byte-compares
 * APP_STORE_URL / PLAY_STORE_URL below against the marketing SSOT
 * `mingla-marketing/lib/store-links.ts` and FAILS the PR when any
 * `apps.apple.com` / `play.google.com/store` / `go.usemingla.com` literal
 * exists in mingla-business outside THIS file (kills the F-12 recurrence
 * class + enforces the ORCH-1346 one-branded-domain-one-template rule:
 * `go.usemingla.com` is consumer-owned; business links mint on
 * `minglabiz.onelink.me`, never go.*).
 */

// The two LIVE public consumer store listings — byte-identical values to
// mingla-marketing/lib/store-links.ts (CI-enforced). NEVER a TestFlight URL.
export const APP_STORE_URL = "https://apps.apple.com/app/id6760440898";
export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.mingla.app.v2";

// The marketing smart-download route (ORCH-1319 §4.2): ONE QR/URL serves both
// platforms — an iPhone hitting /download → App Store, Android → Play. This is
// the dark-mode QR target while the guest-funnel OneLink is not yet live.
export const DOWNLOAD_PAGE_URL = "https://usemingla.com/download";

/**
 * The guest-funnel OneLink base — SPEC §4.1's GO-LIVE FLIP CONSTANT.
 *
 * `null` = DARK (store-direct behavior: CTA opens the platform store, QR
 * encodes DOWNLOAD_PAGE_URL). At AppsFlyer go-live (fresh consumer native
 * builds + APPSFLYER_S2S_TOKEN — COMMS-0083) Seth flips this to
 * `'https://go.usemingla.com/w36m'` in a one-line `[deploy]` PR (consumer
 * OneLink template `w36m` on the LIVE branded domain — ORCH-1346/A-1; URL
 * grammar mirrors app-mobile/src/services/oneLinkShare.ts).
 *
 * A CODE constant, NOT an env var: EXPO_PUBLIC_* web-export inlining is
 * non-deterministic across build paths (COMMS-0028 class); a code flip is
 * auditable and unit-testable (SPEC §4.1 rationale).
 */
export const GUEST_FUNNEL_ONELINK_URL: string | null = null;

/**
 * THE BUSINESS-APP OneLink — ORCH-1378 [business invite download CTA].
 *
 * Live-verified by curl on 2026-07-15 (BOTH platforms, 301 on both):
 *   Android → market://details?id=com.sethogieva.minglabusiness
 *             &referrer=af_tranid%3D…      ← the `referrer` IS the attribution
 *                                            (it rides the Play Install Referrer
 *                                            into the install)
 *   iOS     → https://apps.apple.com/US/app/id6768737367?mt=8
 *
 * ⚠️ FOUR THINGS THIS MUST NEVER BECOME — each is a real, specific failure:
 *
 *  1. NEVER `go.usemingla.com` — that branded domain is EXPLORER/CONSUMER-owned.
 *     One AppsFlyer branded domain maps to exactly ONE OneLink template
 *     (ORCH-1346), so a business link minted on go.* redirects per the CONSUMER
 *     template → the WRONG STORE LISTING.
 *  2. NEVER `minglabiz.onelink.me` — the raw vendor base. It works, but it is not
 *     the branded domain and it is not what we measure on.
 *  3. NEVER reuse `GUEST_FUNNEL_ONELINK_URL` above — that is the CONSUMER
 *     guest-funnel flip constant and it is still `null` (dark).
 *  4. NEVER `usemingla.com/business/download` — that page carries a PLAIN store
 *     link, so the install arrives with NO ATTRIBUTION. The whole point of the
 *     OneLink is the `af_tranid` referrer.
 *
 * Per-channel params (`?pid=…&c=…`) are minted AT THE CALL SITE, mirroring the
 * proven `guestFunnelLink.ts:122-134` grammar — the base stays clean here.
 *
 * A CODE constant, not an env var: EXPO_PUBLIC_* web-export inlining is
 * non-deterministic across build paths (COMMS-0028 class); a code constant is
 * auditable and unit-testable.
 *
 * SSOT-ENFORCED (ORCH-1378): `.github/scripts/strict-grep/orch-1342-store-links-ssot.mjs`
 * now BANS a `biz.usemingla.com` literal anywhere in mingla-business outside this
 * file. That ban did NOT exist before — the gate was proven decorative for this
 * domain (a raw literal injected outside the SSOT PASSED it).
 */
export const BUSINESS_INVITE_ONELINK_URL = "https://biz.usemingla.com/ZSCW";
