// ---------------------------------------------------------------
// ORCH-1324 [business "Get the app" → device-aware] — HAPPY-PATH regression test.
// REWRITTEN BY ORCH-1381 [business-getapp-android-choice].
//
// WHAT CHANGED AND WHY. This file used to REQUIRE the ternary
// `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` on both
// surfaces. That was the ORCH-1324 contract; it is now THE BUG — it sends every
// Android owner to the web app instead of the business Play listing, which went
// live 2026-07-15 (COMMS-0101). The ternary asserts are therefore INVERTED to
// asserted-ABSENT, and replaced with the shared-helper + two-action contract.
//
// Proves BOTH business CTAs (glass-nav.tsx organiser branch + the organiser hero)
// present the inline CHOICE: each delegates to resolveBusinessAppTarget() via
// detectClientPlatform(), renders BUSINESS_APP_CHOICE_COPY, fires
// get_the_app_clicked { surface:'organiser' } with the right `location` AND both
// `action: 'download'` / `action: 'use_web'`, and carries the
// window.location.assign popup fallback.
//
// The marketing package has NO jest/vitest runner wired — this is a SOURCE-level
// pin run via the repo's tsc+node pattern (mirrors lib/device-platform.test.ts).
// Run from mingla-marketing/:
//   npx tsc components/marketing/__tests__/business-getapp-cta.test.ts \
//     --outDir /tmp/o --module commonjs --target es2020 --moduleResolution node \
//     && node /tmp/o/business-getapp-cta.test.js
//
// Fails-on-revert: reverting either CTA to the ORCH-1324 single-action ternary
// removes the helper call + BUSINESS_APP_CHOICE_COPY + the action discriminators
// and re-introduces the banned ternary, so those assertions throw. (The RUNTIME
// guard for the decision itself is lib/__tests__/business-app-target.test.ts T-1 —
// this file is a source-level pin on the wiring.)
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'

const NAV = path.resolve(process.cwd(), 'components/marketing/glass-nav.tsx')
const HERO = path.resolve(
  process.cwd(),
  'components/sections/organiser-home/hero.tsx',
)

const nav = fs.readFileSync(NAV, 'utf8')
const hero = fs.readFileSync(HERO, 'utf8')

// The business handler bodies in glass-nav, scoped so we never match the EXPLORER
// handler (which also fires get_the_app_clicked / location:'nav'). ORCH-1381 split
// the single business handler into two — one per action.
const scopeHandler = (src: string, name: string): string => {
  const i = src.indexOf(`${name} = `)
  if (i === -1) return ''
  const rest = src.slice(i)
  const end = rest.indexOf('\n  }')
  return end === -1 ? rest.slice(0, 700) : rest.slice(0, end)
}

const navDownloadHandler = scopeHandler(nav, 'handleDownloadTheBusinessApp')
const navWebHandler = scopeHandler(nav, 'handleUseBusinessOnWeb')
// The shared open+popup-fallback helper both business actions route through.
const navOpenHelper = scopeHandler(nav, 'openBusinessDest')
// Both business handlers together — for file-scoped business assertions that must
// not see the explorer handler.
const navHandler = navDownloadHandler + '\n' + navWebHandler

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  // ── glass-nav organiser branch ──────────────────────────────────────────────
  [
    'nav: delegates to the shared decision helper + renders the shared copy',
    () => {
      assert(
        /resolveBusinessAppTarget\(/.test(nav),
        'nav does not call resolveBusinessAppTarget — the decision must come from the ONE module',
      )
      assert(
        /BUSINESS_APP_CHOICE_COPY/.test(nav),
        'nav does not render BUSINESS_APP_CHOICE_COPY (labels must not be hand-written)',
      )
    },
  ],
  [
    'nav: the ORCH-1324 collapsed ternary is GONE (it denied Android owners the app)',
    () => {
      assert(
        !/platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/.test(nav),
        'nav still carries the ORCH-1324 collapsed ternary — every Android owner would be sent to the web app instead of the LIVE business Play listing',
      )
    },
  ],
  [
    'nav: both business handlers resolve the platform via detectClientPlatform()',
    () => {
      assert(navDownloadHandler.length > 0, 'handleDownloadTheBusinessApp handler not found in nav')
      assert(navWebHandler.length > 0, 'handleUseBusinessOnWeb handler not found in nav')
      assert(
        /detectClientPlatform\(\)/.test(navDownloadHandler),
        'nav download handler does not call detectClientPlatform()',
      )
      assert(
        /resolveBusinessAppTarget\(/.test(navDownloadHandler),
        'nav download handler does not resolve via resolveBusinessAppTarget',
      )
    },
  ],
  [
    "nav: fires get_the_app_clicked with surface:'organiser', location:'nav' and BOTH actions",
    () => {
      assert(/get_the_app_clicked/.test(navHandler), 'nav handlers missing get_the_app_clicked')
      assert(/surface: 'organiser'/.test(navHandler), "nav handlers missing surface: 'organiser'")
      assert(/location: 'nav'/.test(navHandler), "nav handlers missing location: 'nav'")
      // Without the discriminator, an Android owner who CHOOSES web is
      // indistinguishable from ORCH-1324's forced-web → the fix is unmeasurable.
      assert(/action: 'download'/.test(navDownloadHandler), "nav download handler missing action: 'download'")
      assert(/action: 'use_web'/.test(navWebHandler), "nav web handler missing action: 'use_web'")
    },
  ],
  [
    'nav: both business actions navigate through the popup-blocked fallback',
    () => {
      // The nav factors the open+fallback into a shared `openBusinessDest` helper,
      // so assert the REAL path: both handlers route through it, and it carries
      // window.open + the window.location.assign fallback (no dead tap on either
      // action when a popup is blocked).
      assert(
        /openBusinessDest\(/.test(navDownloadHandler),
        'nav download handler does not navigate via openBusinessDest',
      )
      assert(
        /openBusinessDest\(/.test(navWebHandler),
        'nav web handler does not navigate via openBusinessDest',
      )
      assert(
        /window\.open\(/.test(navOpenHelper),
        'nav openBusinessDest does not open via window.open(',
      )
      assert(
        /window\.location\.assign\(/.test(navOpenHelper),
        'nav openBusinessDest missing the window.location.assign popup-blocked fallback (a blocked popup would be a dead tap)',
      )
    },
  ],
  [
    'nav: organiser CTA renders BOTH actions from the shared copy constants',
    () => {
      assert(
        /onClick=\{handleDownloadTheBusinessApp\}/.test(nav),
        'nav organiser download button is not wired to handleDownloadTheBusinessApp',
      )
      assert(
        /onClick=\{handleUseBusinessOnWeb\}/.test(nav),
        'nav organiser web button is not wired to handleUseBusinessOnWeb',
      )
      assert(
        /BUSINESS_APP_CHOICE_COPY\.download/.test(nav),
        'nav download CTA label is not BUSINESS_APP_CHOICE_COPY.download',
      )
      assert(
        /BUSINESS_APP_CHOICE_COPY\.useWeb/.test(nav),
        'nav web CTA label is not BUSINESS_APP_CHOICE_COPY.useWeb',
      )
      // Desktop can install nothing → the install button must be canInstall-gated.
      assert(
        /canInstall/.test(nav),
        'nav does not gate the install button on canInstall — desktop would get a dead button',
      )
    },
  ],
  // ── organiser hero ──────────────────────────────────────────────────────────
  [
    'hero: delegates to the shared decision helper + renders the shared copy',
    () => {
      assert(
        /resolveBusinessAppTarget\(/.test(hero),
        'hero does not call resolveBusinessAppTarget — the decision must come from the ONE module',
      )
      assert(
        /BUSINESS_APP_CHOICE_COPY/.test(hero),
        'hero does not render BUSINESS_APP_CHOICE_COPY (labels/note must not be hand-written)',
      )
      assert(/detectClientPlatform\(\)/.test(hero), 'hero does not call detectClientPlatform()')
    },
  ],
  [
    'hero: the ORCH-1324 collapsed ternary is GONE (it denied Android owners the app)',
    () => {
      assert(
        !/platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/.test(hero),
        'hero still carries the ORCH-1324 collapsed ternary — every Android owner would be sent to the web app instead of the LIVE business Play listing',
      )
    },
  ],
  [
    "hero: fires get_the_app_clicked with surface:'organiser', location:'hero' and BOTH actions",
    () => {
      assert(/get_the_app_clicked/.test(hero), 'hero missing get_the_app_clicked')
      assert(/surface: 'organiser'/.test(hero), "hero missing surface: 'organiser'")
      assert(/location: 'hero'/.test(hero), "hero missing location: 'hero'")
      assert(/action: 'download'/.test(hero), "hero missing action: 'download'")
      assert(/action: 'use_web'/.test(hero), "hero missing action: 'use_web'")
    },
  ],
  [
    'hero: has the window.location.assign popup fallback',
    () => {
      assert(
        /window\.location\.assign\(/.test(hero),
        'hero missing window.location.assign popup fallback',
      )
    },
  ],
  [
    'hero: CTA renders BOTH actions + the shared note (NOT the retired iPhone-only subcopy)',
    () => {
      assert(
        /onClick=\{handleDownloadTheBusinessApp\}/.test(hero),
        'hero download button is not wired to handleDownloadTheBusinessApp',
      )
      assert(
        /onClick=\{handleUseBusinessOnWeb\}/.test(hero),
        'hero web button is not wired to handleUseBusinessOnWeb',
      )
      assert(
        /BUSINESS_APP_CHOICE_COPY\.download/.test(hero),
        'hero download CTA label is not BUSINESS_APP_CHOICE_COPY.download',
      )
      assert(
        /BUSINESS_APP_CHOICE_COPY\.useWeb/.test(hero),
        'hero web CTA label is not BUSINESS_APP_CHOICE_COPY.useWeb',
      )
      // The old subcopy was the same falsehood as the email's: it told Android
      // owners the app was iPhone-only. It must NOT come back.
      assert(
        !/On iPhone now — or get started on the web\./.test(hero),
        'hero still renders the retired ORCH-1324 subcopy ("On iPhone now — or get started on the web.") — FALSE since the business Play listing went live (COMMS-0101)',
      )
      assert(
        /BUSINESS_APP_CHOICE_COPY\.moreNote/.test(hero) &&
          /BUSINESS_APP_CHOICE_COPY\.desktopNote/.test(hero),
        'hero does not render both the phone (moreNote) and desktop (desktopNote) notes from the shared copy constant',
      )
    },
  ],
  [
    'hero: gates the install button on canInstall (no dead desktop button)',
    () => {
      assert(
        /canInstall/.test(hero),
        'hero does not gate the install button on canInstall — desktop would get a dead install button',
      )
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1324 business Get-the-app CTA (happy-path)', () => {
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
  console.log(`\nAll ${cases.length} business-getapp happy-path tests passed`)
}
