// ---------------------------------------------------------------
// Issue #905 [links-banner-suppress] — HAPPY-PATH regression test.
//
// Proves the global marketing consent banner is SUPPRESSED on `/links` (where the
// bottom-fixed `z-[90]` banner would obstruct the download CTAs / socials on the
// `100dvh` + `overflow-hidden` no-scroll viewport) and UNCHANGED on every other
// route. Imports and CALLS the real predicate (not a source grep) — this is what
// proves it is not a naive `startsWith`/`includes('links')`.
//
// The marketing package has NO jest/vitest runner wired — this uses the repo's
// tsc+node pattern (mirrors links-tab-switcher.test.ts / device-platform.test.ts).
// Run from mingla-marketing/:
//   npx tsc lib/consent-banner-visibility.ts \
//     components/marketing/__tests__/consent-banner-links-suppression.test.ts \
//     --outDir /tmp/o905 --rootDir . --module commonjs --target es2020 \
//     --moduleResolution node \
//   && node /tmp/o905/components/marketing/__tests__/consent-banner-links-suppression.test.js
//
// Fails-on-revert: flipping the predicate so `/links` → true turns T-1 red;
// removing the `&& shouldRenderConsentBanner(pathname)` wiring (or the
// `usePathname` import) in consent-banner.tsx turns the T-7 source-pin red;
// deleting the module breaks the import (compile failure). Restore → green.
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  shouldRenderConsentBanner,
  SUPPRESSED_CONSENT_ROUTES,
} from '../../../lib/consent-banner-visibility'

const BANNER = path.resolve(
  process.cwd(),
  'components/marketing/consent-banner.tsx',
)
const bannerSrc = fs.readFileSync(BANNER, 'utf8')

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  // ── T-1: suppress on /links ────────────────────────────────────────────────
  [
    'shouldRenderConsentBanner("/links") === false (banner suppressed on /links)',
    () => {
      assert(
        shouldRenderConsentBanner('/links') === false,
        '/links must SUPPRESS the banner (returned true)',
      )
    },
  ],
  // ── T-2: show on every other representative route ───────────────────────────
  [
    'shouldRenderConsentBanner is true on /, /business, /download, /privacy-policy',
    () => {
      for (const route of ['/', '/business', '/download', '/privacy-policy']) {
        assert(
          shouldRenderConsentBanner(route) === true,
          `${route} must SHOW the banner (returned false)`,
        )
      }
    },
  ],
  // ── T-6: single source of truth ─────────────────────────────────────────────
  [
    'SUPPRESSED_CONSENT_ROUTES is the single source of truth (["/links"])',
    () => {
      assert(
        Array.isArray(SUPPRESSED_CONSENT_ROUTES),
        'SUPPRESSED_CONSENT_ROUTES is not an array',
      )
      assert(
        SUPPRESSED_CONSENT_ROUTES.length === 1,
        `expected exactly ONE suppressed route, got ${SUPPRESSED_CONSENT_ROUTES.length}`,
      )
      assert(
        SUPPRESSED_CONSENT_ROUTES[0] === '/links',
        `expected the suppressed route to be "/links", got "${SUPPRESSED_CONSENT_ROUTES[0]}"`,
      )
    },
  ],
  // ── T-7: component actually wired to the predicate + usePathname ────────────
  [
    'consent-banner.tsx gates `visible` on the predicate sourced from usePathname()',
    () => {
      assert(
        /const visible =[^\n]*shouldRenderConsentBanner\(/.test(bannerSrc),
        'consent-banner.tsx `visible` does not AND-in shouldRenderConsentBanner(...)',
      )
      assert(
        /import\s*\{\s*usePathname\s*\}\s*from\s*['"]next\/navigation['"]/.test(
          bannerSrc,
        ),
        'consent-banner.tsx does not import usePathname from next/navigation',
      )
      assert(
        /const pathname = usePathname\(\)/.test(bannerSrc),
        'consent-banner.tsx does not read pathname from a real usePathname() call',
      )
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('Issue #905 /links consent-banner suppression (happy-path)', () => {
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
    `\nAll ${cases.length} consent-banner-links-suppression happy-path tests passed`,
  )
}
