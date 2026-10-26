// ---------------------------------------------------------------
// Issue #905 → #2331 — TESTER-ADVERSARIAL test (bar mechanics).
//
// [TEST-MOD-APPROVED #2331] #905 suppressed the consent banner on /links
// because a floating card covered the CTAs there. #2331 replaces that rule
// with I-PRIVACY-BAR-NEVER-OCCLUDES: one slim full-width bar on EVERY route,
// and /links sizes itself to calc(100dvh - var(--mingla-privacy-inset)).
// Attacks the inset writer and the slim, never-wrapping collapsed row.
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

const SUITE = '#2331 marketing privacy bar mechanics (tester)'

const cases: ReadonlyArray<[string, () => void]> = [
  ['the bar writes its live height to --mingla-privacy-inset and resets it to 0px', () => {
    assert(/new ResizeObserver\(measure\)/.test(banner), 'the bar must observe its own size')
    assert(/setProperty\(PRIVACY_INSET_PROPERTY/.test(banner), 'the bar must write the inset property')
    assert(/writeInset\(0\)/.test(banner), 'hiding the bar must reset the inset to 0px')
  }],
  ['the document scroll area gets the same bottom padding', () => {
    assert(banner.includes('body{padding-bottom:var(${PRIVACY_INSET_PROPERTY},0px)}'), 'body must pad by the inset so the last line can scroll clear')
  }],
  ['the collapsed row is one 44px line that never wraps', () => {
    assert(banner.includes('.mpb-row{max-width:1200px;height:44px'), 'the row is exactly 44px')
    assert(/\.mpb-text\{[^}]*white-space:nowrap[^}]*text-overflow:ellipsis/.test(banner), 'the sentence ends in an ellipsis, never a second line')
    assert(banner.includes('.mpb{position:fixed;left:0;right:0;bottom:0;'), 'the bar is full-bleed at the bottom')
  }],
  ['the privacy policy link stays absolute (career.usemingla.com rewrites paths)', () => {
    assert(banner.includes('href={`${SITE_ORIGIN}/privacy-policy`}'), 'privacy policy must be absolute')
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
