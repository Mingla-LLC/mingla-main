// ---------------------------------------------------------------
// Issue #905 [links-banner-suppress] — TESTER-ADVERSARIAL test.
//
// Different angle than the happy-path (which proves the affirmative decision
// table). This attacks the route-match EDGES / negative space — the exact spots
// a lazy `startsWith`/`includes('links')` implementation would get wrong — and
// proves the fix did NOT quietly change the banner's off-route behavior:
//   (a) trailing slash `/links/` still suppresses (normalized).
//   (b) `/linksomething` and `/links/deep` must NOT suppress (EXACT match, the
//       real prefix false-match the bug class hinges on).
//   (c) null / empty / query-bearing / case edges default to SHOW.
//   (d) source-pin (comment-stripped): the banner's storage key, animation, and
//       GA consent-mode calls survive untouched, and `pathname` comes from a real
//       `usePathname()` call — not a hardcoded string or a comment.
//
// Run from mingla-marketing/ via the repo tsc+node pattern:
//   npx tsc lib/consent-banner-visibility.ts \
//     components/marketing/__tests__/consent-banner-links-suppression.tester.test.ts \
//     --outDir /tmp/o905 --rootDir . --module commonjs --target es2020 \
//     --moduleResolution node \
//   && node /tmp/o905/components/marketing/__tests__/consent-banner-links-suppression.tester.test.js
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'
import { shouldRenderConsentBanner } from '../../../lib/consent-banner-visibility'

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const BANNER = path.resolve(
  process.cwd(),
  'components/marketing/consent-banner.tsx',
)
const bannerSrc = stripComments(fs.readFileSync(BANNER, 'utf8'))

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  // ── (a) trailing slash still suppresses ─────────────────────────────────────
  [
    'shouldRenderConsentBanner("/links/") === false (one trailing slash normalized)',
    () => {
      assert(
        shouldRenderConsentBanner('/links/') === false,
        '/links/ must still SUPPRESS (trailing-slash normalization dropped)',
      )
    },
  ],
  // ── (b) prefix / subpath false-match rejected ───────────────────────────────
  [
    'prefix + subpath do NOT suppress: /linksomething and /links/deep → true',
    () => {
      assert(
        shouldRenderConsentBanner('/linksomething') === true,
        '/linksomething must SHOW — this is a prefix false-match (startsWith/includes bug)',
      )
      assert(
        shouldRenderConsentBanner('/links/deep') === true,
        '/links/deep must SHOW — only the EXACT /links viewport is suppressed',
      )
    },
  ],
  // ── (c) null / empty / query-bearing / case edges default to SHOW ───────────
  [
    'null, "", query-bearing /links?src=x, and /LINKS all default to SHOW',
    () => {
      assert(
        shouldRenderConsentBanner(null) === true,
        'null pathname must SHOW (safe default)',
      )
      assert(
        shouldRenderConsentBanner('') === true,
        'empty pathname must SHOW (safe default)',
      )
      // usePathname() strips the query, but a query-bearing string must NOT match
      // the exact-membership check either (defends the predicate's own contract).
      assert(
        shouldRenderConsentBanner('/links?src=bio_instagram') === true,
        '/links?src=... must NOT match (predicate input is query-stripped by usePathname)',
      )
      assert(
        shouldRenderConsentBanner('/LINKS') === true,
        '/LINKS must SHOW — route matching is case-sensitive (no case-folding)',
      )
    },
  ],
  // ── (d) off-route no-change + real usePathname source-pin ───────────────────
  [
    'off-route behavior + real usePathname() survive (comment-stripped source-pin)',
    () => {
      assert(
        /mingla_consent_v1/.test(bannerSrc),
        'consent-banner.tsx lost the CONSENT_STORAGE_KEY value mingla_consent_v1',
      )
      assert(
        /AnimatePresence/.test(bannerSrc),
        'consent-banner.tsx lost the AnimatePresence animation wrapper',
      )
      assert(
        /\(\s*['"]consent['"]\s*,\s*['"]update['"]/.test(bannerSrc),
        'consent-banner.tsx lost the GA4 Consent Mode consent/update calls',
      )
      assert(
        /const pathname = usePathname\(\)/.test(bannerSrc),
        'consent-banner.tsx pathname must come from a real usePathname() call (not a comment/hardcode)',
      )
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('Issue #905 /links consent-banner suppression (adversarial)', () => {
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
    `\nAll ${cases.length} consent-banner-links-suppression adversarial tests passed`,
  )
}
