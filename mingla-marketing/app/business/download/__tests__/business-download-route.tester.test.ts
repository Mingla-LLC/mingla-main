// ---------------------------------------------------------------
// ORCH-1326 [links business tab reflects the live app] — TESTER-ADVERSARIAL test.
// REWRITTEN BY ORCH-1381 [business-getapp-android-choice].
//
// WHAT CHANGED AND WHY. This file used to pin the route as a REDIRECT and to
// forbid Play entirely ("business Android → the web app, never a Play listing").
// Both were correct under ORCH-1324 and are now FALSE: the business Play listing
// went live 2026-07-15 (production versionCode 33 / 1.1.2 — COMMS-0101), and the
// route now renders an inline CHOICE instead of redirecting. The old asserts would
// have locked the bug in place, so they are inverted here.
//
// Different angle than the links-config happy-path (which pins the CTA href). This
// proves the /business/download ROUTE's negative space + correct shape:
//   (a) NO QR/badges — the route does NOT import DownloadQr / AppStoreBadges nor
//       render a <QRCode (the deliberate difference from the explorer /download).
//   (b) SSOT — NO `apps.apple.com` / `business.usemingla.com` / `play.google.com`
//       literal (destinations come from the shared helper, never hardcoded).
//   (c) NO bare CONSUMER `PLAY_STORE_URL` (owners must never be shipped the
//       consumer app) — but BUSINESS_PLAY_STORE_URL via the helper is REQUIRED.
//   (d) SSR-safe — NO `navigator` / `window` (Server Component, UA header only).
//   (e) the route RENDERS the choice: no `redirect(`, real <a> anchors, both
//       install + web destinations referenced, and it branches on `canInstall`
//       (desktop gets no dead install button).
//
// Comment-stripped (mirrors the ORCH-1326 strict-grep guard) so the informative
// header comment naming apps.apple.com / QR / PLAY_STORE_URL never trips the
// ABSENCE assertions.
//
// Run from mingla-marketing/ via the repo tsc+node pattern:
//   npx tsc app/business/download/__tests__/business-download-route.tester.test.ts \
//     --outDir /tmp/o --module commonjs --target es2020 --moduleResolution node \
//     && node /tmp/o/business-download-route.tester.test.js
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'

const ROUTE = path.resolve(process.cwd(), 'app/business/download/page.tsx')

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const src = stripComments(fs.readFileSync(ROUTE, 'utf8'))

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  // ── (a) NO QR/badges (the difference from /download) ────────────────────────
  [
    'the route imports NO DownloadQr / AppStoreBadges and renders NO <QRCode',
    () => {
      assert(!/DownloadQr/.test(src), 'route imports DownloadQr (business route has no QR)')
      assert(!/AppStoreBadges/.test(src), 'route imports AppStoreBadges (business route has no badges)')
      assert(!/<QRCode/.test(src), 'route renders a <QRCode (business route has no QR)')
    },
  ],
  // ── ORCH-1382 T-11 ⭐ THE INSTALL HREF IS THE ATTRIBUTED ONELINK ────────────
  // And CRITICALLY: this route must self-attribute with NO query param. Its href is
  // BYTE-FROZEN in the partner-invite email to exactly
  // `https://usemingla.com/business/download` with no query string
  // (orch-1329-invite-email.tester.test.ts). So attribution CANNOT ride in on the
  // URL — it must be composed server-side from this surface's own identity. Appending
  // a param to the invite-email href to carry it would break the byte-frozen pin and
  // is the single easiest way to fail this ORCH's CI.
  [
    'T-11: the install href is the attributed Business OneLink, self-attributed with NO query param',
    () => {
      assert(
        /siteAttribution\(\s*'business_download'\s*\)/.test(src),
        "the route does not compose siteAttribution('business_download') — it MUST derive its own attribution server-side, because the invite-email href that lands here is byte-frozen with NO query string (ORCH-1329)",
      )
      assert(
        /resolveBusinessAppTarget\(\s*platform\s*,\s*siteAttribution\(/.test(src),
        'the route does not pass an attribution argument to resolveBusinessAppTarget( — a bare 1-arg call ships an unattributed OneLink that works perfectly and reports nothing (ORCH-1382 §5.2.4)',
      )
      // The route must NOT read a query param for attribution — that is the
      // byte-frozen breach.
      assert(
        !/searchParams/.test(src),
        'the route reads searchParams — the invite-email href is BYTE-FROZEN with no query string, so requiring a param would silently break attribution for every invited owner (ORCH-1329 / ORCH-1382 §7.2)',
      )
    },
  ],
  // ── (b) SSOT — no hardcoded store/web literals ──────────────────────────────
  [
    'the route hardcodes NO store/web literal and delegates to the shared helper',
    () => {
      assert(!/apps\.apple\.com/.test(src), 'route inlines a literal App Store URL (must come from the shared helper)')
      assert(!/business\.usemingla\.com/.test(src), 'route inlines the literal business web URL (must come from the shared helper)')
      assert(!/play\.google\.com/.test(src), 'route inlines a literal Play URL (must come from the shared helper)')
      // ORCH-1381: the BUSINESS_* consts moved behind lib/business-app-target.
      // Requiring them HERE would re-create the 5-call-site triplication that let
      // one store going live leave four surfaces stale.
      assert(
        /resolveBusinessAppTarget/.test(src),
        'route does not resolve via resolveBusinessAppTarget (the ONE decision module)',
      )
    },
  ],
  // ── (c) never the CONSUMER Play const (owners must not get the consumer app) ─
  [
    'the route references NO bare consumer PLAY_STORE_URL (the business package is a different app)',
    () => {
      // Word-anchored: BUSINESS_PLAY_STORE_URL is CORRECT and must not trip this.
      // (The pre-ORCH-1381 gate used an unanchored /PLAY_STORE_URL/ here and in CI,
      // which substring-matched the business const and failed the PR.)
      assert(
        !/\bPLAY_STORE_URL\b/.test(src),
        'route references the CONSUMER PLAY_STORE_URL — business Android must go to the BUSINESS Play listing (com.sethogieva.minglabusiness), not the consumer app',
      )
    },
  ],
  // ── (d) SSR-safe (no client globals) ────────────────────────────────────────
  [
    'the route is SSR-safe — no navigator / window',
    () => {
      assert(!/\bnavigator\b/.test(src), 'route reads `navigator` (SSR-unsafe)')
      assert(!/\bwindow\b/.test(src), 'route reads `window` (SSR-unsafe)')
    },
  ],
  // ── (e) the route RENDERS the choice — it no longer redirects ────────────────
  [
    'the route renders an inline choice (no redirect) with both destinations + canInstall',
    () => {
      assert(
        !/redirect\(/.test(src),
        'route still calls redirect( — ORCH-1381 replaced the 307 with an inline choice; an auto-redirect denies the choice (and on iOS would strand invite-email arrivals straight into the App Store)',
      )
      assert(/<a[\s>]/.test(src), 'route renders no <a> anchor — the choice must be plain anchors (no client JS)')
      assert(
        /target\.installHref/.test(src),
        'route never references target.installHref — the Download action is missing',
      )
      assert(
        /target\.webHref/.test(src),
        'route never references target.webHref — the Use-on-web action is missing',
      )
      assert(
        /canInstall/.test(src),
        'route does not branch on canInstall — desktop would get a dead install button',
      )
    },
  ],
  // ── (f) the note is the shared, code-verified constant ──────────────────────
  [
    'the note comes from BUSINESS_APP_CHOICE_COPY (a claim, not decoration)',
    () => {
      assert(
        /BUSINESS_APP_CHOICE_COPY/.test(src),
        'route hand-writes its labels/note instead of using BUSINESS_APP_CHOICE_COPY — that is how a code-verified claim silently becomes an invented one',
      )
    },
  ],
  // ── (g) no raw / consumer-owned OneLink ─────────────────────────────────────
  // RATIONALE CORRECTED BY ORCH-1382: the raw *.onelink.me ban is ROUTING POLICY
  // (branded domains only, ORCH-1346) — NOT "the OneLink is dead". COMMS-0101's "DEAD
  // on Android" claim is STALE: re-proven false by execution 2026-07-15 (5/5
  // Android-UA curls -> 301 market://). The ban stands; only the false "why" is fixed.
  [
    'the route routes through NO raw or consumer-owned OneLink domain',
    () => {
      assert(
        !/minglabiz\.onelink\.me/.test(src),
        'route references the RAW minglabiz.onelink.me domain — business traffic uses the branded biz.usemingla.com (ORCH-1346 routing policy)',
      )
      assert(
        !/go\.usemingla\.com/.test(src),
        'route references go.usemingla.com — consumer-owned (ORCH-1346: 1 domain = 1 template); business owners would install the Explorer app',
      )
      // SSOT — the base lives in store-links.ts; a surface literal is drift.
      assert(
        !/['"`]https:\/\/biz\.usemingla\.com/.test(src),
        'route hardcodes the biz.usemingla.com literal — reference BUSINESS_ONELINK_URL from lib/store-links (ORCH-1382 SSOT)',
      )
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1326 /business/download route (adversarial)', () => {
    for (const [name, fn] of cases) it(name, fn)
  })
} else {
  let failures = 0
  for (const [name, fn] of cases) {
    try {
      fn()
      // eslint-disable-next-line no-console
      console.log(`PASS  ${name}`)
    } catch (err) {
      failures += 1
      // eslint-disable-next-line no-console
      console.error(`FAIL  ${name}: ${(err as Error).message}`)
    }
  }
  if (failures > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failures} test(s) failed`)
    process.exit(1)
  }
  // eslint-disable-next-line no-console
  console.log(`\nAll ${cases.length} business-download-route adversarial tests passed`)
}
