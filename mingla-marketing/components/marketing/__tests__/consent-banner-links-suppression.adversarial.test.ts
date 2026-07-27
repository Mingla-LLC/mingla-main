// ---------------------------------------------------------------
// Issue #905 [links-banner-suppress] — TESTER ADVERSARIAL suite (route-SET integrity).
//
// DIFFERENT ANGLE from BOTH prior suites. The implementor's happy-path proves the
// affirmative decision table, and the implementor's `.tester.test.ts` attacks the
// route-MATCH edges (trailing slash, prefix false-match, null/case) — i.e. "does a
// given input STRING match?". This suite instead attacks the SUPPRESSION SET itself:
// over-suppression / route-set integrity / no-collateral compliance regression.
//
// The failure mode under attack: someone silently GROWS `SUPPRESSED_CONSENT_ROUTES`
// (e.g. adds a SCROLLING route like `/` or `/business`, or a whole family) — which
// would kill the legally-required consent solicitation on a real page (or site-wide).
// The route-string-match suites do NOT catch that: they only assert specific inputs.
// This suite pins the SET to exactly {"/links"} and asserts every consent-REQUIRED
// route (the full known marketing route set) still SHOWS the banner.
//
// Marketing has no jest/vitest runner — repo tsc+node pattern (mirrors
// links-tab-switcher.test.ts). Run from mingla-marketing/:
//   npx tsc lib/consent-banner-visibility.ts \
//     components/marketing/__tests__/consent-banner-links-suppression.adversarial.test.ts \
//     --outDir /tmp/o905 --rootDir . --module commonjs --target es2020 \
//     --moduleResolution node \
//   && node /tmp/o905/components/marketing/__tests__/consent-banner-links-suppression.adversarial.test.js
//
// Fails-on-revert:
//   • Predicate neutralized (always-true): T-A3 `/links`→false expectation flips RED.
//   • Over-suppression (add `/business` to the list): T-A1 (set size), T-A2 (forbidden
//     consent-required set), T-A3 (table `/business`→true), T-A4 (single source literal)
//     all flip RED.
//   • Suppression set emptied (`[]`): T-A1 + T-A3 (`/links`→false) flip RED.
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  shouldRenderConsentBanner,
  SUPPRESSED_CONSENT_ROUTES,
} from '../../../lib/consent-banner-visibility'

const MODULE = path.resolve(process.cwd(), 'lib/consent-banner-visibility.ts')
const moduleSrc = fs.readFileSync(MODULE, 'utf8')

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

// The FULL known marketing route set (from app/ route dirs + the anon buyer web
// families /e /b /t). Each row is [pathname, expectedShow]. `true` = banner SHOWS
// (consent solicited); `false` = SUPPRESSED. ONLY `/links` may be false.
const ROUTE_TABLE: ReadonlyArray<[string, boolean]> = [
  ['/', true],
  ['/business', true],
  ['/download', true],
  ['/privacy-policy', true],
  ['/e/some-brand/some-event', true], // anon buyer event page family
  ['/b/some-brand', true], // anon buyer brand page family
  ['/t/some-trip', true], // anon buyer trip page family
  ['/tools', true],
  ['/schedule', true],
  ['/support', true],
  ['/careers', true],
  ['/terms-of-service', true],
  ['/sms-terms', true],
  ['/links', false], // the ONLY suppressed route
]

// Consent-REQUIRED routes: every scrolling / real page that MUST still solicit
// consent. If any of these ever enters the suppression set, consent dies on that
// page (a compliance regression). `/links` is deliberately EXCLUDED.
const CONSENT_REQUIRED_ROUTES: readonly string[] = ROUTE_TABLE.filter(
  ([, show]) => show,
).map(([route]) => route)

const cases: ReadonlyArray<[string, () => void]> = [
  // ── T-A1: the suppression SET is exactly {"/links"} — no more, no less ───────
  [
    'T-A1 SUPPRESSED_CONSENT_ROUTES is EXACTLY ["/links"] (over-suppression guard)',
    () => {
      const set = SUPPRESSED_CONSENT_ROUTES as readonly string[]
      assert(
        Array.isArray(set),
        'SUPPRESSED_CONSENT_ROUTES must be an array',
      )
      assert(
        set.length === 1,
        `SUPPRESSED_CONSENT_ROUTES grew to ${set.length} entries [${set.join(
          ', ',
        )}] — over-suppression risk. Only /links may suppress the banner; a scrolling route here kills consent solicitation on that page.`,
      )
      assert(
        set[0] === '/links',
        `the sole suppressed route must be "/links", got "${set[0]}"`,
      )
      // De-dup guard: exactly one distinct member.
      assert(
        new Set(set).size === 1,
        'SUPPRESSED_CONSENT_ROUTES has duplicate/extra distinct members',
      )
    },
  ],
  // ── T-A2: no consent-REQUIRED route is ever a suppression member ─────────────
  [
    'T-A2 no consent-required (scrolling) route is in the suppression set',
    () => {
      const set = new Set(SUPPRESSED_CONSENT_ROUTES as readonly string[])
      for (const route of CONSENT_REQUIRED_ROUTES) {
        assert(
          !set.has(route),
          `COMPLIANCE REGRESSION: "${route}" is a consent-required page but appears in SUPPRESSED_CONSENT_ROUTES — its cookie banner would never solicit consent.`,
        )
        // and the predicate itself must SHOW the banner there
        assert(
          shouldRenderConsentBanner(route) === true,
          `COMPLIANCE REGRESSION: shouldRenderConsentBanner("${route}") returned false — a real page lost its consent banner.`,
        )
      }
    },
  ],
  // ── T-A3: full route-set table — exactly which show vs suppress ──────────────
  [
    'T-A3 full known-route table: only /links suppresses, everything else shows',
    () => {
      const suppressed: string[] = []
      for (const [route, expectedShow] of ROUTE_TABLE) {
        const actualShow = shouldRenderConsentBanner(route)
        assert(
          actualShow === expectedShow,
          `route "${route}": expected show=${expectedShow}, got show=${actualShow}`,
        )
        if (!actualShow) suppressed.push(route)
      }
      // The set of routes the predicate suppresses across the WHOLE table must be
      // exactly {"/links"} — catches both over-suppression AND under-suppression.
      assert(
        suppressed.length === 1 && suppressed[0] === '/links',
        `predicate suppressed [${suppressed.join(
          ', ',
        )}] across the known route set — expected exactly ["/links"].`,
      )
    },
  ],
  // ── T-A4: single-source-of-truth literal (source-pin, comment-stripped) ──────
  [
    'T-A4 the SUPPRESSED_CONSENT_ROUTES declaration lists /links as the ONLY route literal',
    () => {
      // Strip comments so the doc-comment examples (/linksomething, /links/deep,
      // /LINKS) can't be mistaken for list members.
      const codeOnly = moduleSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
      const decl = /SUPPRESSED_CONSENT_ROUTES\s*=\s*\[([^\]]*)\]/.exec(codeOnly)
      assert(
        decl !== null,
        'could not locate the SUPPRESSED_CONSENT_ROUTES = [ ... ] array literal',
      )
      const literals = (decl![1].match(/['"`][^'"`]*['"`]/g) || []).map((s) =>
        s.slice(1, -1),
      )
      assert(
        literals.length === 1,
        `the SUPPRESSED_CONSENT_ROUTES literal contains ${literals.length} route strings [${literals.join(
          ', ',
        )}] — exactly one ("/links") is allowed. A second literal here is an over-suppression regression.`,
      )
      assert(
        literals[0] === '/links',
        `the sole route literal must be "/links", got "${literals[0]}"`,
      )
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('Issue #905 /links consent-banner suppression (route-set integrity)', () => {
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
  console.log(
    `\nAll ${cases.length} consent-banner-links-suppression route-set-integrity tests passed`,
  )
}
