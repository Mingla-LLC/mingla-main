// ---------------------------------------------------------------
// ORCH-1399 [links-src-tracking-getapp-stack] — TESTER ADVERSARIAL test (T-7). ⭐
//
// ONE JOB: prove the Explorer and Business OneLinks are NEVER CROSSED (H-2).
//
// WHY THIS IS THE HIGHEST-DAMAGE BUG AVAILABLE HERE. The two bases differ by a
// handful of characters (`go.usemingla.com/w36m` vs `biz.usemingla.com/ZSCW`) and are
// declared four lines apart in the same file. Swap them and NOTHING looks broken:
// every CTA still works, every link still 301s, every store still opens. It is just
// the WRONG APP — a business owner installs the consumer Explorer app, a consumer
// installs the business app — and BOTH apps' attribution is silently poisoned. No
// error, no crash, no failing render. This is precisely the class of bug that no
// presence check, and no amount of eyeballing, will ever catch.
//
// BY IDENTITY, NOT SUBSTRING. Asserting `href.includes('biz.usemingla.com')` would
// still pass if someone repointed BUSINESS_ONELINK_URL at the consumer TEMPLATE on
// the business domain (biz.usemingla.com/w36m) — a real, easy mistake, since one
// branded domain maps to exactly one template (ORCH-1346). So this compares resolved
// values against the CONSTANTS THEMSELVES and pins the template ids.
//
// DIFFERENT ANGLE FROM T-4 (links-src.tester): T-4 attacks the pid VALUE. This
// attacks the DESTINATION. A perfect pid on the wrong app is still a total loss.
//
// Run from mingla-marketing/ (repo tsc+node pattern; the package has no jest):
//   npx tsc lib/__tests__/onelink-never-crossed.tester.test.ts --outDir /tmp/o \
//     --module commonjs --target es2020 --moduleResolution node \
//     && node /tmp/o/__tests__/onelink-never-crossed.tester.test.js
//
// APPEND-ONLY: this file is a NEW tester artifact. Do not weaken or delete it.
// ---------------------------------------------------------------

import { resolveBusinessAppTarget } from '../business-app-target'
import { resolveExplorerAppTarget } from '../explorer-app-target'
import { linksAttribution, siteAttribution } from '../links-src'
import {
  APP_STORE_URL,
  BUSINESS_APP_STORE_URL,
  BUSINESS_ONELINK_URL,
  BUSINESS_PLAY_STORE_URL,
  BUSINESS_WEB_URL,
  EXPLORER_ONELINK_URL,
  PLAY_STORE_URL,
} from '../store-links'
import type { Platform } from '../device-platform'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const PLATFORMS: readonly Platform[] = ['ios', 'android', 'other']
const ATTRS = [
  linksAttribution('youtube', 'explorer_bio'),
  linksAttribution('direct', 'business_bio'),
  siteAttribution('business_nav'),
  siteAttribution('explorer_nav'),
]

const cases: ReadonlyArray<[string, () => void]> = [
  // ── C-1 ⭐ THE BASES ARE DISTINCT AND CORRECTLY OWNED ───────────────────────
  [
    'C-1: the two OneLink bases are distinct, branded, and mapped to the RIGHT template',
    () => {
      const explorer: string = EXPLORER_ONELINK_URL
      const business: string = BUSINESS_ONELINK_URL
      assert(explorer !== business, 'the two OneLink bases are BYTE-IDENTICAL — one app is unreachable and its attribution is gone')

      // Consumer base: the consumer domain AND the consumer template.
      assert(explorer.includes('go.usemingla.com'), `EXPLORER base is not on the consumer branded domain: ${explorer}`)
      assert(explorer.includes('w36m'), `EXPLORER base does not carry the consumer template id w36m: ${explorer}`)
      assert(!explorer.includes('biz.usemingla.com'), `EXPLORER base is on the BUSINESS domain: ${explorer}`)
      assert(!explorer.includes('ZSCW'), `EXPLORER base carries the BUSINESS template id: ${explorer}`)

      // Business base: the business domain AND the business template.
      assert(business.includes('biz.usemingla.com'), `BUSINESS base is not on the business branded domain: ${business}`)
      assert(business.includes('ZSCW'), `BUSINESS base does not carry the business template id ZSCW: ${business}`)
      assert(!business.includes('go.usemingla.com'), `BUSINESS base is on the CONSUMER domain: ${business}`)
      assert(!business.includes('w36m'), `BUSINESS base carries the CONSUMER template id: ${business}`)

      // ORCH-1346: 1 branded domain = 1 template. A domain/template mismatch (e.g.
      // biz.usemingla.com/w36m) resolves to the WRONG app while looking correct.
      assert(
        !(business.includes('biz.usemingla.com') && business.includes('w36m')),
        `BUSINESS base pairs the business domain with the CONSUMER template — it would install the consumer app: ${business}`,
      )
      assert(
        !(explorer.includes('go.usemingla.com') && explorer.includes('ZSCW')),
        `EXPLORER base pairs the consumer domain with the BUSINESS template — it would install the business app: ${explorer}`,
      )
    },
  ],
  // ── C-2 NO RAW *.onelink.me ANYWHERE ───────────────────────────────────────
  [
    'C-2: neither base is a raw *.onelink.me domain (branded domains only, ORCH-1346)',
    () => {
      for (const [label, base] of [['EXPLORER', EXPLORER_ONELINK_URL], ['BUSINESS', BUSINESS_ONELINK_URL]] as const) {
        assert(!/onelink\.me/.test(base), `${label} base uses a RAW OneLink domain: ${base}`)
        assert(!/minglabiz\.onelink\.me/.test(base), `${label} base uses the raw business OneLink domain: ${base}`)
        assert(!/^https:\/\/mingla\.onelink\.me/.test(base), `${label} base uses the raw consumer OneLink domain: ${base}`)
        assert(/^https:\/\/[a-z]+\.usemingla\.com\//.test(base), `${label} base is not a branded usemingla.com OneLink: ${base}`)
      }
    },
  ],
  // ── C-3 ⭐ THE BUSINESS SURFACE CAN NEVER EMIT A CONSUMER DESTINATION ───────
  [
    'C-3: no business target ever resolves to a CONSUMER destination (by identity)',
    () => {
      for (const platform of PLATFORMS) {
        for (const attr of ATTRS) {
          const t = resolveBusinessAppTarget(platform, attr)
          const href = t.installHref ?? ''
          assert(
            !href.includes('go.usemingla.com'),
            `business/${platform}: installHref carries the CONSUMER branded domain — owners would install the Explorer app: ${href}`,
          )
          assert(
            !href.includes('w36m'),
            `business/${platform}: installHref carries the CONSUMER template id: ${href}`,
          )
          // By identity against the consumer constants themselves — still fires if
          // someone repoints a constant rather than editing a surface.
          assert(href !== PLAY_STORE_URL, `business/${platform}: installHref IS the consumer Play listing`)
          assert(href !== APP_STORE_URL, `business/${platform}: installHref IS the consumer App Store listing`)
          assert(!href.startsWith(EXPLORER_ONELINK_URL), `business/${platform}: installHref IS the Explorer OneLink: ${href}`)
        }
      }
    },
  ],
  // ── C-4 ⭐ THE EXPLORER SURFACE CAN NEVER EMIT A BUSINESS DESTINATION ───────
  [
    'C-4: no explorer target ever resolves to a BUSINESS destination (by identity)',
    () => {
      for (const platform of PLATFORMS) {
        for (const attr of ATTRS) {
          const href = resolveExplorerAppTarget(platform, attr).installHref ?? ''
          assert(
            !href.includes('biz.usemingla.com'),
            `explorer/${platform}: installHref carries the BUSINESS branded domain — consumers would install the business app: ${href}`,
          )
          assert(!href.includes('ZSCW'), `explorer/${platform}: installHref carries the BUSINESS template id: ${href}`)
          assert(href !== BUSINESS_PLAY_STORE_URL, `explorer/${platform}: installHref IS the business Play listing`)
          assert(href !== BUSINESS_APP_STORE_URL, `explorer/${platform}: installHref IS the business App Store listing`)
          assert(href !== BUSINESS_WEB_URL, `explorer/${platform}: installHref IS the business web app`)
          assert(!href.startsWith(BUSINESS_ONELINK_URL), `explorer/${platform}: installHref IS the Business OneLink: ${href}`)
        }
      }
    },
  ],
  // ── C-5 THE TWO HELPERS NEVER AGREE ON A DESTINATION ───────────────────────
  [
    'C-5: the explorer and business helpers never resolve to the SAME install href',
    () => {
      for (const platform of ['ios', 'android'] as const) {
        for (const attr of ATTRS) {
          const explorer = resolveExplorerAppTarget(platform, attr).installHref
          const business = resolveBusinessAppTarget(platform, attr).installHref
          assert(
            explorer !== business,
            `CROSSED — ${platform}: the explorer and business helpers resolve to the SAME href (${String(explorer)}). One of the two apps is now unreachable from the marketing site and its attribution is dead.`,
          )
        }
      }
    },
  ],
  // ── C-6 no raw onelink.me can reach ANY emitted href ───────────────────────
  [
    'C-6: no emitted href on either surface ever carries a raw *.onelink.me domain',
    () => {
      for (const platform of PLATFORMS) {
        for (const attr of ATTRS) {
          const hrefs = [
            resolveExplorerAppTarget(platform, attr).installHref,
            resolveBusinessAppTarget(platform, attr).installHref,
            resolveBusinessAppTarget(platform, attr).webHref,
          ]
          for (const href of hrefs) {
            assert(
              !/onelink\.me/.test(href ?? ''),
              `${platform}: an emitted href carries a RAW *.onelink.me domain (branded only, ORCH-1346): ${href}`,
            )
          }
        }
      }
    },
  ],
  // ── C-7 the business "choice" must stay real ───────────────────────────────
  [
    'C-7: the business install and web destinations are never the same (no fake choice)',
    () => {
      for (const platform of ['ios', 'android'] as const) {
        for (const attr of ATTRS) {
          const t = resolveBusinessAppTarget(platform, attr)
          assert(
            t.installHref !== t.webHref,
            `FAKE CHOICE — ${platform}: "Get the app" and "Use on web" both resolve to "${t.webHref}". Two buttons, one destination.`,
          )
          assert(
            t.installHref !== BUSINESS_WEB_URL,
            `REVERTED — ${platform}: installHref is BUSINESS_WEB_URL; ${platform} owners are denied the app (the ORCH-1381 bug).`,
          )
        }
      }
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1399 OneLinks never crossed (tester adversarial)', () => {
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
    console.error(`\n${failures} adversarial test(s) failed`)
    process.exit(1)
  }
  // eslint-disable-next-line no-console
  console.log(`\nAll ${cases.length} ORCH-1399 never-crossed adversarial tests passed`)
}
