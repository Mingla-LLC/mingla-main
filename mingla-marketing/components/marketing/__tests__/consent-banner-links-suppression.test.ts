// ---------------------------------------------------------------
// Issue #905 → #2331 /links privacy bar — HAPPY-PATH regression test.
//
// [TEST-MOD-APPROVED #2331] #905 suppressed the consent banner on /links
// because a floating card covered the CTAs there. #2331 replaces that rule
// with I-PRIVACY-BAR-NEVER-OCCLUDES: one slim full-width bar on EVERY route,
// and /links sizes itself to calc(100dvh - var(--mingla-privacy-inset)).
// Proves /links shows the bar and ends above it.
//
// Run from mingla-marketing/ (repo tsc+node pattern, no lib module needed):
//   npx tsc components/marketing/__tests__/<this file>.ts --outDir /tmp/o905 \
//     --rootDir . --module commonjs --target es2020 --moduleResolution node \
//   && node /tmp/o905/components/marketing/__tests__/<this file>.js
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'

const read = (rel: string): string => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
const banner = stripComments(read('components/marketing/consent-banner.tsx'))
const links = stripComments(read('components/marketing/links-experience.tsx'))
const provider = stripComments(read('components/marketing/posthog-provider.tsx'))

const SUITE = '#2331 /links privacy bar (happy-path)'

const cases: ReadonlyArray<[string, () => void]> = [
  ['the route-suppression module is gone', () => {
    assert(!fs.existsSync(path.resolve(process.cwd(), 'lib/consent-banner-visibility.ts')), 'lib/consent-banner-visibility.ts must be deleted')
  }],
  ['the bar never asks the route whether to show', () => {
    assert(!/shouldRenderConsentBanner|SUPPRESSED_CONSENT_ROUTES|usePathname/.test(banner), 'consent-banner.tsx must not suppress by route')
    assert(/const visible = mounted && \(!privacy\.saved \|\| reopened\)/.test(banner), 'the bar shows while no choice is saved')
  }],
  ['/links sizes itself above the bar', () => {
    assert(links.includes("height: 'calc(100dvh - var(--mingla-privacy-inset, 0px))'"), '/links must subtract the privacy inset from 100dvh')
    assert(links.includes('h-[calc(100svh-var(--mingla-privacy-inset,0px))]'), '/links svh fallback must subtract the inset too')
  }],
  ['/links ends with the in-page "Your privacy choices" link', () => {
    assert(/<PrivacyChoicesLink\b/.test(links), '/links must render PrivacyChoicesLink at the end of its content')
  }],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe(SUITE, () => {
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
  console.log(`\nAll ${cases.length} ${SUITE} tests passed`)
}
