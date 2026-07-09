// ---------------------------------------------------------------
// ORCH-1328 [links-cta-soft-nav-blank-page] — TESTER-ADVERSARIAL test.
//
// Different angle than the happy-path (which proves PRESENCE of the device-aware
// button). This proves the ABSENCE of the soft-nav regression AND the correct
// device binding in links-experience.tsx:
//   (a) NO `from 'next/link'`, NO `<Link` element (no soft-navigation).
//   (b) NO hardcoded store literal (apps.apple.com / play.google.com) — SSOT only.
//   (c) the Business branch is `platform === 'ios' ? BUSINESS_APP_STORE_URL :
//       BUSINESS_WEB_URL` and NOT the reversed order (no everyone→App Store / no
//       stranded non-iOS).
//   (d) the Explorer phone branch is `platform === 'ios' ? APP_STORE_URL :
//       PLAY_STORE_URL` and NOT reversed (Android must land on Play).
//   (e) Desktop-Explorer still reaches the QR: the handler opens `tab.cta.href`
//       (the /download QR page is preserved).
//   (f) the window.location.assign( popup-block fallback exists (no silent failure).
//   (g) the CTA is keyboard-activatable: a <button type="button"> (native
//       Enter/Space) — NOT a role="button" div.
//
// Comment-stripped (mirrors the ORCH-1328 strict-grep guard) so the informative
// code comments that legitimately NAME the removed <Link>/soft-nav route never
// trip the ABSENCE assertions.
//
// Run from mingla-marketing/ via the repo tsc+node pattern:
//   npx tsc components/marketing/__tests__/links-cta-device-aware.tester.test.ts \
//     --outDir /tmp/o --module commonjs --target es2020 --moduleResolution node \
//     && node /tmp/o/links-cta-device-aware.tester.test.js
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'

const CTA = path.resolve(
  process.cwd(),
  'components/marketing/links-experience.tsx',
)

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const src = stripComments(fs.readFileSync(CTA, 'utf8'))

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  // ── (a) no soft-navigation ───────────────────────────────────────────────────
  [
    'no next/link import and no <Link> element (the CTA never soft-navigates)',
    () => {
      assert(!/from\s+['"]next\/link['"]/.test(src), 'still imports next/link — the CTA can soft-navigate again')
      // Word-boundary: `<Link[\s/>]` matches the <Link> JSX element but not the
      // unrelated <Linkedin> icon / <LinksTab…> generic types in this file.
      assert(!/<Link[\s/>]/.test(src), 'still renders a next/link <Link> element (soft-nav regressed)')
    },
  ],
  // ── (b) no hardcoded store literal ──────────────────────────────────────────
  [
    'no hardcoded store URL literal (apps.apple.com / play.google.com) — SSOT only',
    () => {
      assert(!/apps\.apple\.com/.test(src), 'hardcodes an apps.apple.com literal (must use the store-links consts)')
      assert(!/play\.google\.com/.test(src), 'hardcodes a play.google.com literal (must use the store-links consts)')
    },
  ],
  // ── (c) Business branch correct, not reversed ───────────────────────────────
  [
    "Business branch is platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL (not reversed)",
    () => {
      assert(
        /platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/.test(src),
        'Business branch is missing/altered (iOS must → BUSINESS_APP_STORE_URL, else → BUSINESS_WEB_URL)',
      )
      assert(
        !/platform === 'ios' \? BUSINESS_WEB_URL : BUSINESS_APP_STORE_URL/.test(src),
        'Business branch is REVERSED (iOS → web, non-iOS → App Store) — strands users',
      )
    },
  ],
  // ── (d) Explorer phone branch correct, not reversed ─────────────────────────
  [
    "Explorer phone branch is platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL (not reversed)",
    () => {
      assert(
        /platform === 'ios' \? APP_STORE_URL : PLAY_STORE_URL/.test(src),
        'Explorer phone branch is missing/altered (iOS → App Store, Android → Play)',
      )
      assert(
        !/platform === 'ios' \? PLAY_STORE_URL : APP_STORE_URL/.test(src),
        'Explorer phone branch is REVERSED (iOS → Play, Android → App Store)',
      )
    },
  ],
  // ── (e) desktop-Explorer preserves the QR ───────────────────────────────────
  [
    'desktop-Explorer still opens the /download QR page (openExternal(tab.cta.href))',
    () => {
      assert(
        /openExternal\(tab\.cta\.href\)/.test(src),
        'the desktop/other Explorer branch no longer opens tab.cta.href (the /download QR page is lost)',
      )
    },
  ],
  // ── (f) popup-block fallback present ────────────────────────────────────────
  [
    'the window.location.assign( popup-block fallback exists (no silent failure)',
    () => {
      assert(/window\.open\(/.test(src), 'no window.open( — the store is not opened on the gesture')
      assert(/window\.location\.assign\(/.test(src), 'missing the window.location.assign( popup-block fallback')
    },
  ],
  // ── (g) keyboard-activatable native button ──────────────────────────────────
  [
    'the CTA is a native <button type="button"> (not a role="button" div)',
    () => {
      assert(/<button/.test(src), 'the CTA is not a <button>')
      assert(/type="button"/.test(src), 'the CTA <button> lacks type="button"')
      assert(!/role="button"/.test(src), 'a role="button" (non-native) control is used — must be a real <button>')
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1328 links CTA opens the store client-side (adversarial)', () => {
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
  console.log(`\nAll ${cases.length} links-cta-device-aware adversarial tests passed`)
}
