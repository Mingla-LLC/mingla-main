// ---------------------------------------------------------------
// ORCH-1326 [links business tab reflects the live app] — TESTER-ADVERSARIAL test.
//
// Different angle than the links-config happy-path (which pins the CTA href). This
// proves the /business/download ROUTE's negative space + correct destination:
//   (a) NO QR/badges — the route does NOT import DownloadQr / AppStoreBadges nor
//       render a <QRCode (the deliberate difference from the explorer /download).
//   (b) SSOT — NO `apps.apple.com` / `business.usemingla.com` literal (the
//       destinations come from lib/store-links consts, never hardcoded).
//   (c) NO `PLAY_STORE_URL` (business Android → the web app, never a Play listing).
//   (d) SSR-safe — NO `navigator` / `window` (Server Component, UA header only).
//   (e) the NON-iOS redirect target is BUSINESS_WEB_URL, and the App Store target
//       is gated behind `platform === 'ios'` (no everyone → App Store; no reversed
//       mapping that would strand Android/desktop owners).
//
// Comment-stripped (mirrors the ORCH-1326 strict-grep guard) so the informative
// header comment naming apps.apple.com / QR never trips the ABSENCE assertions.
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
  // ── (b) SSOT — no hardcoded store/web literals ──────────────────────────────
  [
    'the route hardcodes NO apps.apple.com / business.usemingla.com literal (consts only)',
    () => {
      assert(!/apps\.apple\.com/.test(src), 'route inlines a literal App Store URL (use BUSINESS_APP_STORE_URL)')
      assert(!/business\.usemingla\.com/.test(src), 'route inlines the literal business web URL (use BUSINESS_WEB_URL)')
      assert(/BUSINESS_APP_STORE_URL/.test(src), 'route does not reference BUSINESS_APP_STORE_URL')
      assert(/BUSINESS_WEB_URL/.test(src), 'route does not reference BUSINESS_WEB_URL')
    },
  ],
  // ── (c) NO Play listing (business Android → web) ────────────────────────────
  [
    'the route references NO PLAY_STORE_URL (business Android → the web app)',
    () => {
      assert(!/PLAY_STORE_URL/.test(src), 'route references PLAY_STORE_URL (business Android must go to the web app, not Play)')
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
  // ── (e) correct device mapping (non-iOS → BUSINESS_WEB_URL) ──────────────────
  [
    'non-iOS lands on BUSINESS_WEB_URL; the App Store is gated behind platform === ios',
    () => {
      assert(
        /platform === 'ios'\)\s*redirect\(BUSINESS_APP_STORE_URL\)/.test(src),
        'the App Store redirect is not gated behind `platform === ios`',
      )
      assert(
        /redirect\(BUSINESS_WEB_URL\)/.test(src),
        'the route has no `redirect(BUSINESS_WEB_URL)` (non-iOS default destination)',
      )
      assert(
        !/platform === 'ios'\)\s*redirect\(BUSINESS_WEB_URL\)/.test(src),
        'REVERSED mapping — iOS would go to the web app instead of the App Store',
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
