// ---------------------------------------------------------------
// Issue #905 → #2331 — TESTER ADVERSARIAL suite (data rule).
//
// [TEST-MOD-APPROVED #2331] #905 suppressed the consent banner on /links
// because a floating card covered the CTAs there. #2331 replaces that rule
// with I-PRIVACY-BAR-NEVER-OCCLUDES: one slim full-width bar on EVERY route,
// and /links sizes itself to calc(100dvh - var(--mingla-privacy-inset)).
// Attacks the data rule: on unless turned off, the copy, and the storage key.
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

const SUITE = '#2331 marketing privacy data rule (adversarial)'

const cases: ReadonlyArray<[string, () => void]> = [
  ['analytics and ads are each on unless the saved choice turned them off', () => {
    assert(/return choice === null \? true : choice\.analytics/.test(provider), 'analytics defaults on')
    assert(/return choice === null \? !marketingGlobalPrivacyControlOn\(\) : choice\.ads/.test(provider), 'ads default on unless GPC')
  }],
  ['the saved choice is mingla_privacy_v2 and v1 is carried over then removed', () => {
    assert(provider.includes("MARKETING_PRIVACY_STORAGE_KEY = 'mingla_privacy_v2'"), 'v2 key')
    assert(/window\.localStorage\.removeItem\(MARKETING_LEGACY_CONSENT_STORAGE_KEY\)/.test(provider), 'v1 removed after carry-over')
  }],
  ['the copy is the approved copy and the retired copy is gone everywhere', () => {
    for (const copy of ['Mingla uses cookies for analytics and ads.', 'Cookies for analytics and ads.', 'Your privacy choices', 'Turn off all']) {
      assert(banner.includes(copy), `missing copy: ${copy}`)
    }
    assert(!/Nothing is set until you|Nothing is tracked until you|Accept all|>\s*Reject\s*</.test(banner), 'retired copy must be gone')
  }],
  ['every footer offers "Your privacy choices" as an in-page link', () => {
    for (const rel of ['components/marketing/footer.tsx', 'components/cutout/footer.tsx', 'components/page-system/page-system-shell.tsx']) {
      assert(/<PrivacyChoicesLink\b/.test(stripComments(read(rel))), `${rel} must render PrivacyChoicesLink`)
    }
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
