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
// #4339: the privacy read and capture facades moved to marketing-capture.ts (speed budget); the provider re-exports them.
const provider = stripComments(`${read('components/marketing/posthog-provider.tsx')}\n${read('components/marketing/marketing-capture.ts')}`)

const SUITE = '#2331 /links privacy bar (happy-path)'

const cases: ReadonlyArray<[string, () => void]> = [
  ['the route-suppression module is gone', () => {
    assert(!fs.existsSync(path.resolve(process.cwd(), 'lib/consent-banner-visibility.ts')), 'lib/consent-banner-visibility.ts must be deleted')
  }],
  // #4318 (Seth): the bar became one permanent strip, rendered from the first
  // HTML on every route; nothing decides whether it shows.
  ['the strip never asks the route (or a saved choice) whether to show', () => {
    assert(!/shouldRenderConsentBanner|SUPPRESSED_CONSENT_ROUTES|usePathname/.test(banner), 'consent-banner.tsx must not suppress by route')
    assert(!/privacy\.saved|const visible/.test(banner), 'the strip shows whatever was saved')
    assert(/data-testid="privacy-strip"/.test(banner), 'the strip renders')
  }],
  ['/links sizes itself above the bar', () => {
    assert(links.includes("height: 'calc(100dvh - var(--mingla-privacy-inset, 0px))'"), '/links must subtract the privacy inset from 100dvh')
    assert(links.includes('h-[calc(100svh-var(--mingla-privacy-inset,0px))]'), '/links svh fallback must subtract the inset too')
  }],
  // #4318 (Seth, feedback 15): the separate "Privacy choices" text link comes off
  // /links and every other page; the bar is the one place to choose, and it
  // folds to a "Privacy settings" button after a choice (adversarial suite).
  ['/links carries no separate "Privacy choices" text link (#4318)', () => {
    assert(!/<PrivacyChoicesLink\b|privacy-choices-link/.test(links), '/links must not render PrivacyChoicesLink')
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
