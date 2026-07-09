// ---------------------------------------------------------------
// ORCH-1328 [links-cta-soft-nav-blank-page] — HAPPY-PATH regression test.
//
// Proves the /links per-tab CTA is a device-aware client <button> that opens the
// store/web app DIRECTLY on the tap (so /links stays mounted) — NOT the old Next
// <Link> soft-navigation into the /download|/business/download external-redirect
// route (which stranded the tab on a blank Explorer / footer-only Business shell —
// INVESTIGATION_ORCH-1328). Asserts PRESENCE in links-experience.tsx:
//   - detectClientPlatform imported; all four store consts referenced.
//   - the CTA is a <button type="button"> bound to onClick={() => onCtaClick(activeTab)}.
//   - window.open( present AND the window.location.assign( popup-block fallback present.
//   - the per-tab branch tab.id === 'business' present.
//   - links_page_cta_clicked fired.
//   - the button keeps the recipe cn(CTA_BASE, CTA_INTENT[activeTab.cta.intent]).
//
// The marketing package has NO jest/vitest runner wired — this is a SOURCE-level
// pin run via the repo's tsc+node pattern (mirrors links-tab-switcher.test.ts).
// NOT comment-stripped (presence-only). Run from mingla-marketing/:
//   npx tsc components/marketing/__tests__/links-cta-device-aware.test.ts \
//     --outDir /tmp/o --module commonjs --target es2020 --moduleResolution node \
//     && node /tmp/o/links-cta-device-aware.test.js
//
// Fails-on-revert: restoring the <Link href={activeTab.cta.href}> CTA deletes
// <button / window.open( / window.location.assign(, so those assertions throw.
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'

const CTA = path.resolve(
  process.cwd(),
  'components/marketing/links-experience.tsx',
)

const src = fs.readFileSync(CTA, 'utf8')

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  [
    'detectClientPlatform is imported (device-aware store choice)',
    () => {
      assert(/detectClientPlatform/.test(src), 'CTA no longer imports/calls detectClientPlatform')
    },
  ],
  [
    'all four store-links consts are referenced (SSOT)',
    () => {
      assert(/\bAPP_STORE_URL\b/.test(src), 'missing APP_STORE_URL')
      assert(/\bPLAY_STORE_URL\b/.test(src), 'missing PLAY_STORE_URL')
      assert(/\bBUSINESS_APP_STORE_URL\b/.test(src), 'missing BUSINESS_APP_STORE_URL')
      assert(/\bBUSINESS_WEB_URL\b/.test(src), 'missing BUSINESS_WEB_URL')
    },
  ],
  [
    'the CTA is a <button type="button"> bound to onCtaClick(activeTab)',
    () => {
      assert(/<button/.test(src), 'CTA is no longer a <button> (soft-nav <Link>/<a> regressed)')
      assert(/type="button"/.test(src), 'CTA <button> missing type="button"')
      assert(
        /onClick=\{\(\) => onCtaClick\(activeTab\)\}/.test(src),
        'CTA <button> no longer binds onClick={() => onCtaClick(activeTab)}',
      )
    },
  ],
  [
    'opens the store client-side with the popup-block fallback',
    () => {
      assert(/window\.open\(/.test(src), 'CTA no longer opens via window.open( on the tap gesture')
      assert(/window\.location\.assign\(/.test(src), 'CTA missing the window.location.assign( popup-block fallback')
    },
  ],
  [
    'the per-tab branch tab.id === \'business\' is present (device-aware per surface)',
    () => {
      assert(/tab\.id === 'business'/.test(src), 'handler no longer branches on tab.id === \'business\'')
    },
  ],
  [
    'the links_page_cta_clicked analytics is preserved',
    () => {
      assert(/links_page_cta_clicked/.test(src), 'CTA no longer fires links_page_cta_clicked')
    },
  ],
  [
    'the button keeps the CTA token recipe cn(CTA_BASE, CTA_INTENT[activeTab.cta.intent])',
    () => {
      assert(
        /cn\(CTA_BASE, CTA_INTENT\[activeTab\.cta\.intent\]\)/.test(src),
        'CTA lost the cn(CTA_BASE, CTA_INTENT[activeTab.cta.intent]) recipe (visual/focus-ring drift)',
      )
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1328 links CTA opens the store client-side (happy-path)', () => {
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
  console.log(`\nAll ${cases.length} links-cta-device-aware happy-path tests passed`)
}
