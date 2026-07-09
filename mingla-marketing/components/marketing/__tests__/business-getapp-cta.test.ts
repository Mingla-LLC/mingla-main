// ---------------------------------------------------------------
// ORCH-1324 [business "Get the app" → device-aware] — HAPPY-PATH regression test.
//
// Proves BOTH business CTAs (glass-nav.tsx organiser branch + the organiser hero)
// are wired to the device-aware "Get the app" action: each resolves
// `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` via
// detectClientPlatform(), fires get_the_app_clicked { surface:'organiser' } with
// the right `location`, and carries the window.location.assign popup fallback.
//
// The marketing package has NO jest/vitest runner wired — this is a SOURCE-level
// pin run via the repo's tsc+node pattern (mirrors lib/device-platform.test.ts).
// Run from mingla-marketing/:
//   npx tsc components/marketing/__tests__/business-getapp-cta.test.ts \
//     --outDir /tmp/o --module commonjs --target es2020 --moduleResolution node \
//     && node /tmp/o/business-getapp-cta.test.js
//
// Fails-on-revert: reverting either CTA back to the beta lead-modal open-state
// handler removes handleGetTheBusinessApp + `surface: 'organiser'` + the
// BUSINESS_* ternary, so the corresponding assertions throw.
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

// The business handler body in glass-nav, scoped so we never match the EXPLORER
// handler (which also fires get_the_app_clicked / location:'nav').
const navHandler = (() => {
  const i = nav.indexOf('handleGetTheBusinessApp = ')
  if (i === -1) return ''
  const rest = nav.slice(i)
  const end = rest.indexOf('\n  }')
  return end === -1 ? rest.slice(0, 700) : rest.slice(0, end)
})()

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  // ── glass-nav organiser branch ──────────────────────────────────────────────
  [
    'nav: references BOTH BUSINESS_APP_STORE_URL and BUSINESS_WEB_URL',
    () => {
      assert(/BUSINESS_APP_STORE_URL/.test(nav), 'nav missing BUSINESS_APP_STORE_URL')
      assert(/BUSINESS_WEB_URL/.test(nav), 'nav missing BUSINESS_WEB_URL')
    },
  ],
  [
    'nav: business handler resolves the device-aware ternary via detectClientPlatform()',
    () => {
      assert(navHandler.length > 0, 'handleGetTheBusinessApp handler not found in nav')
      assert(
        /platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/.test(navHandler),
        'nav handler missing the `platform === ios ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` ternary',
      )
      assert(
        /detectClientPlatform\(\)/.test(navHandler),
        'nav handler does not call detectClientPlatform()',
      )
    },
  ],
  [
    "nav: fires get_the_app_clicked with surface:'organiser' and location:'nav'",
    () => {
      assert(/get_the_app_clicked/.test(navHandler), 'nav handler missing get_the_app_clicked')
      assert(/surface: 'organiser'/.test(navHandler), "nav handler missing surface: 'organiser'")
      assert(/location: 'nav'/.test(navHandler), "nav handler missing location: 'nav'")
    },
  ],
  [
    'nav: has the window.location.assign popup fallback',
    () => {
      assert(
        /window\.location\.assign\(/.test(navHandler),
        'nav handler missing window.location.assign popup fallback',
      )
    },
  ],
  [
    'nav: organiser CTA is wired to handleGetTheBusinessApp and labelled "Get the app"',
    () => {
      assert(
        /onClick=\{handleGetTheBusinessApp\}/.test(nav),
        'nav organiser button is not wired to handleGetTheBusinessApp',
      )
      assert(/Get the app/.test(nav), 'nav CTA label is not "Get the app"')
    },
  ],
  // ── organiser hero ──────────────────────────────────────────────────────────
  [
    'hero: references BOTH BUSINESS_APP_STORE_URL and BUSINESS_WEB_URL',
    () => {
      assert(/BUSINESS_APP_STORE_URL/.test(hero), 'hero missing BUSINESS_APP_STORE_URL')
      assert(/BUSINESS_WEB_URL/.test(hero), 'hero missing BUSINESS_WEB_URL')
    },
  ],
  [
    'hero: resolves the device-aware ternary via detectClientPlatform()',
    () => {
      assert(
        /platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/.test(hero),
        'hero missing the `platform === ios ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` ternary',
      )
      assert(/detectClientPlatform\(\)/.test(hero), 'hero does not call detectClientPlatform()')
    },
  ],
  [
    "hero: fires get_the_app_clicked with surface:'organiser' and location:'hero'",
    () => {
      assert(/get_the_app_clicked/.test(hero), 'hero missing get_the_app_clicked')
      assert(/surface: 'organiser'/.test(hero), "hero missing surface: 'organiser'")
      assert(/location: 'hero'/.test(hero), "hero missing location: 'hero'")
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
    'hero: CTA is wired to handleGetTheBusinessApp with the locked label + subcopy',
    () => {
      assert(
        /onClick=\{handleGetTheBusinessApp\}/.test(hero),
        'hero button is not wired to handleGetTheBusinessApp',
      )
      assert(/Get the app/.test(hero), 'hero CTA label is not "Get the app"')
      assert(
        /On iPhone now — or get started on the web\./.test(hero),
        'hero subcopy is not the locked ORCH-1324 copy ("On iPhone now — or get started on the web.")',
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
