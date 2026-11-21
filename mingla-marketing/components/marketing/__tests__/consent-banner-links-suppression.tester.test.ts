// ---------------------------------------------------------------
// Issue #905 → #2331 — TESTER-ADVERSARIAL test (bar mechanics).
//
// [TEST-MOD-APPROVED #2331] #905 suppressed the consent banner on /links
// because a floating card covered the CTAs there. #2331 replaces that rule
// with I-PRIVACY-BAR-NEVER-OCCLUDES: one slim full-width bar on EVERY route,
// and /links sizes itself to calc(100dvh - var(--mingla-privacy-strip)).
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
// #4339: the privacy read and capture facades moved to marketing-capture.ts (speed budget); the provider re-exports them.
const provider = stripComments(`${read('components/marketing/posthog-provider.tsx')}\n${read('components/marketing/marketing-capture.ts')}`)

const SUITE = '#2331 marketing privacy bar mechanics (tester)'

const cases: ReadonlyArray<[string, () => void]> = [
  // [TEST-MOD-APPROVED #2331] The band is a CSS constant; nothing measures it.
  ['the strip band is the CSS constant --mingla-privacy-strip; nothing measures or writes it', () => {
    assert(!/ResizeObserver|writeInset|setProperty\(/.test(banner), 'no JS may measure the strip or write the variable')
    assert(banner.includes("PRIVACY_STRIP_PROPERTY = '--mingla-privacy-strip'"), 'the one variable name')
  }],
  ['the document scroll area gets the same bottom padding', () => {
    assert(banner.includes('body{padding-bottom:var(--mingla-privacy-strip)}'), 'body must pad by the band so the last line can scroll clear')
  }],
  // #4318 (Seth): the collapsed 44px row is replaced by one 28px strip.
  // #4452 (approved): the inset is clamped with max(…,0px) so a negative or
  // missing env value never shrinks the strip below 28px.
  ['the strip is one full-bleed 28px line (plus the safe area) at the very bottom', () => {
    assert(banner.includes('.mps{position:fixed;left:0;right:0;bottom:0;'), 'the strip is full-bleed at the bottom')
    assert(banner.includes('height:var(--mingla-privacy-strip)'), 'the strip is exactly the band')
    assert(banner.includes(':root{${PRIVACY_STRIP_PROPERTY}:calc(28px + max(env(safe-area-inset-bottom,0px),0px))}'), 'the band is 28px plus the safe area, from the first paint')
    assert(banner.includes('z-index:2147483000'), 'the strip is on the top z-layer')
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
