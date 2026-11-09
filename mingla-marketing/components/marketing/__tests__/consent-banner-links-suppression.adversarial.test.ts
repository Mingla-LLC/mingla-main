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
// #4339: the privacy read and capture facades moved to marketing-capture.ts (speed budget); the provider re-exports them.
const provider = stripComments(`${read('components/marketing/posthog-provider.tsx')}\n${read('components/marketing/marketing-capture.ts')}`)

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
  // #4318 (Seth): the approved copy is the strip's "Privacy & ad choices";
  // the first-visit banner copy, OK and Turn off all are retired.
  ['the copy is the approved copy and the retired copy is gone everywhere', () => {
    for (const copy of ["PRIVACY_STRIP_LABEL = 'Privacy & ad choices'", "PRIVACY_SAVED_LABEL = 'Saved'", 'Ads measurement']) {
      assert(banner.includes(copy), `missing copy: ${copy}`)
    }
    assert(!/Mingla uses cookies|Cookies for analytics|Your privacy choices|Turn off all|Nothing is set until you|Nothing is tracked until you|Accept all|>\s*Reject\s*<|>\s*OK\s*</.test(banner), 'retired copy must be gone')
  }],
  // #4318 (Seth): the strip is the one place to make and change the choice.
  // No footer or sheet carries a "Your privacy choices" link.
  ['no footer carries a separate privacy link; the strip opens the choices', () => {
    for (const rel of ['components/marketing/footer.tsx', 'components/cutout/footer.tsx', 'components/page-system/page-system-shell.tsx', 'components/sections/explorer-home/hero.tsx']) {
      assert(!/PrivacyChoicesLink|privacy-choices-link/.test(stripComments(read(rel))), `${rel} must not render a privacy link`)
    }
    assert(!fs.existsSync(path.resolve(process.cwd(), 'components/marketing/privacy-choices-link.tsx')), 'privacy-choices-link.tsx must be deleted')
    assert(/data-testid="privacy-strip"/.test(banner), 'the strip renders')
    assert(/window\.dispatchEvent\(new Event\(PRIVACY_CHOICES_EVENT\)\)/.test(banner), 'it opens through the one reopen event')
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
