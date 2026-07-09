// ---------------------------------------------------------------
// ORCH-1324 [business "Get the app" → device-aware] — TESTER-ADVERSARIAL test.
//
// Different angle than the happy-path (which proves PRESENCE). This proves the
// ABSENCE of the three failure modes:
//   (a) the retired beta funnel is gone — neither glass-nav's business branch nor
//       the hero imports the beta lead modal or its transport, nor renders the
//       beta CTA label / email input / beta subcopy / open-state setter (the token
//       list below is built from fragments so this file itself is grep-clean).
//   (b) the non-iOS destination is BUSINESS_WEB_URL — the handler must NOT strand
//       Android/desktop owners on the App Store (guards an "everyone → App Store"
//       regression): the ternary is `? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL`
//       and the non-iOS store label is 'business_web', never the reversed mapping.
//   (c) the BUSINESS surface opens NO desktop QR panel — AppQrPanel / setQrOpen
//       never appears in the ORGANISER handler / CTA branch or the hero. (Scoped:
//       the glass-nav EXPLORER branch legitimately KEEPS AppQrPanel/setQrOpen, so
//       this is NOT a whole-file grep of glass-nav.)
//
// Run from mingla-marketing/ via the repo tsc+node pattern:
//   npx tsc components/marketing/__tests__/business-getapp-cta.tester.test.ts \
//     --outDir /tmp/o --module commonjs --target es2020 --moduleResolution node \
//     && node /tmp/o/business-getapp-cta.tester.test.js
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'

const NAV = path.resolve(process.cwd(), 'components/marketing/glass-nav.tsx')
const HERO = path.resolve(
  process.cwd(),
  'components/sections/organiser-home/hero.tsx',
)

// Comment-strip both targets (mirrors the ORCH-1324 strict-grep guard): the
// informative code comments legitimately NAME the retired funnel (e.g. the beta
// lead-modal mount that ORCH-1324 removed) — the ABSENCE assertions below must
// scan CODE only, exactly like the guard, so those breadcrumbs never trip.
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const nav = stripComments(fs.readFileSync(NAV, 'utf8'))
const hero = stripComments(fs.readFileSync(HERO, 'utf8'))

// The business handler body only (never the explorer handler).
const navHandler = (() => {
  const i = nav.indexOf('handleGetTheBusinessApp = ')
  if (i === -1) return ''
  const rest = nav.slice(i)
  const end = rest.indexOf('\n  }')
  return end === -1 ? rest.slice(0, 700) : rest.slice(0, end)
})()

// The organiser CTA JSX branch only (from its `surface === 'organiser'` marker to
// the `) : (` that opens the explorer branch) — so the explorer AppQrPanel wiring
// is never in scope.
const navOrganiserCtaBranch = (() => {
  const btn = nav.indexOf('onClick={handleGetTheBusinessApp}')
  if (btn === -1) return ''
  const start = nav.lastIndexOf("surface === 'organiser'", btn)
  const end = nav.indexOf(') : (', btn)
  return start !== -1 && end !== -1 ? nav.slice(start, end) : ''
})()

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

// The beta-funnel tokens that must NEVER appear in the business CTA surfaces.
// The first five are built from fragments so the literal strings never appear in
// THIS test file — the §4.3 beta-funnel-removal grep must return zero hits across
// all of mingla-marketing (test files included). `frag` re-joins them at runtime,
// so a reverted CTA (the real beta lead-modal JSX / its transport import) still fires.
const frag = (...parts: string[]): RegExp => new RegExp(parts.join(''))
const BETA_TOKENS: ReadonlyArray<RegExp> = [
  frag('Beta', 'AccessModal'),
  frag('beta', '-access-modal'),
  frag('beta', '-access-submit'),
  frag('Get ', 'Beta Access'),
  frag('Free during ', 'beta'),
  /type="email"/,
  /setBetaOpen/,
  /betaOpen/,
]

const cases: ReadonlyArray<[string, () => void]> = [
  // ── (a) the beta funnel is gone from both surfaces ──────────────────────────
  [
    'nav: contains none of the retired beta-funnel tokens',
    () => {
      for (const re of BETA_TOKENS) {
        assert(!re.test(nav), `nav still contains a retired beta-funnel token: ${re}`)
      }
    },
  ],
  [
    'hero: contains none of the retired beta-funnel tokens',
    () => {
      for (const re of BETA_TOKENS) {
        assert(!re.test(hero), `hero still contains a retired beta-funnel token: ${re}`)
      }
    },
  ],
  // ── (b) non-iOS lands on BUSINESS_WEB_URL, not the App Store ─────────────────
  [
    'nav: non-iOS destination is BUSINESS_WEB_URL (no everyone→App Store regression)',
    () => {
      assert(
        /platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/.test(navHandler),
        'nav handler ternary is not `? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL`',
      )
      assert(
        /store: platform === 'ios' \? 'app_store' : 'business_web'/.test(navHandler),
        "nav handler non-iOS store label is not 'business_web'",
      )
      assert(
        !/\? BUSINESS_WEB_URL : BUSINESS_APP_STORE_URL/.test(navHandler),
        'nav handler has the REVERSED ternary (would send iOS to the web, non-iOS to the App Store)',
      )
    },
  ],
  [
    'hero: non-iOS destination is BUSINESS_WEB_URL (no everyone→App Store regression)',
    () => {
      assert(
        /platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/.test(hero),
        'hero ternary is not `? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL`',
      )
      assert(
        /store: platform === 'ios' \? 'app_store' : 'business_web'/.test(hero),
        "hero non-iOS store label is not 'business_web'",
      )
      assert(
        !/\? BUSINESS_WEB_URL : BUSINESS_APP_STORE_URL/.test(hero),
        'hero has the REVERSED ternary (would strand Android/desktop owners on the App Store)',
      )
    },
  ],
  // ── (c) NO QR panel on the business surface (scoped, not whole-file) ─────────
  [
    'nav business handler + organiser CTA branch open NO desktop QR panel',
    () => {
      assert(navHandler.length > 0, 'handleGetTheBusinessApp handler not found in nav')
      assert(navOrganiserCtaBranch.length > 0, 'organiser CTA branch not found in nav')
      assert(!/AppQrPanel/.test(navHandler), 'nav business handler references AppQrPanel')
      assert(!/setQrOpen/.test(navHandler), 'nav business handler calls setQrOpen (QR panel)')
      assert(!/AppQrPanel/.test(navOrganiserCtaBranch), 'organiser CTA branch mounts AppQrPanel')
      assert(!/setQrOpen/.test(navOrganiserCtaBranch), 'organiser CTA branch opens the QR panel (setQrOpen)')
    },
  ],
  [
    'hero opens NO desktop QR panel',
    () => {
      assert(!/AppQrPanel/.test(hero), 'hero references AppQrPanel')
      assert(!/setQrOpen/.test(hero), 'hero calls setQrOpen (QR panel)')
    },
  ],
  // ── Sanity: the explorer branch is UNTOUCHED (AppQrPanel still present) ──────
  // Proves the scoping above is real — glass-nav as a whole still keeps the
  // explorer QR wiring; only the business surface is QR-free.
  [
    'nav: the explorer branch still keeps AppQrPanel/setQrOpen (scoping is real)',
    () => {
      assert(/AppQrPanel/.test(nav), 'glass-nav lost the explorer AppQrPanel (explorer branch broken)')
      assert(/setQrOpen/.test(nav), 'glass-nav lost the explorer setQrOpen wiring')
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1324 business Get-the-app CTA (adversarial)', () => {
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
  console.log(`\nAll ${cases.length} business-getapp adversarial tests passed`)
}
