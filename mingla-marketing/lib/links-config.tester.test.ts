// ---------------------------------------------------------------
// ORCH-1317 [Mingla link-in-bio page] — regression guard for the /links DATA
// CONTRACT. New marketing page, no business logic (BACKFILL-EXEMPT), so this is a
// light data-integrity net, NOT a runtime UI test.
//
// WHY: the value of /links is entirely in WHERE the links point. A silent edit
// that sends the business tab to the app store, drops a social, or hardcodes a
// store URL into the config would still render fine — this pins the destinations.
//
// It imports the React-FREE config + the shared source-of-truth constants and
// runs via the repo's tsc+node pattern (same as download-route-decision.tester):
//   npx tsc lib/links-config.tester.test.ts lib/links-config.ts lib/subdomain.ts \
//     lib/store-links.ts --outDir /tmp/o --module commonjs --target es2020 \
//     --moduleResolution node && node /tmp/o/links-config.tester.test.js
// ---------------------------------------------------------------

import {
  LINKS_TABS,
  LINKS_SOCIALS,
  LINKS_DOWNLOAD_PATH,
  LINKS_BUSINESS_PATH,
  socialHref,
} from './links-config'
import { BUSINESS_PATH } from './subdomain'
import { APP_STORE_URL, PLAY_STORE_URL } from './store-links'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  // ── Tabs: exactly the two documented surfaces, in order ─────────────────────
  [
    'exposes exactly two tabs: explorer then business',
    () => {
      assert(LINKS_TABS.length === 2, `expected 2 tabs, got ${LINKS_TABS.length}`)
      assert(LINKS_TABS[0].id === 'explorer', `tab[0] is ${LINKS_TABS[0].id}`)
      assert(LINKS_TABS[1].id === 'business', `tab[1] is ${LINKS_TABS[1].id}`)
    },
  ],

  // ── Explorer CTA → the device-smart /download route (NOT a raw store URL) ────
  // The single smart CTA is the ONLY download path — no store badges are rendered
  // on /links (the /download route resolves the right store per device).
  [
    'Explorer CTA targets the /download route, never a hardcoded store URL',
    () => {
      const explorer = LINKS_TABS.find((t) => t.id === 'explorer')!
      assert(explorer.cta.href === LINKS_DOWNLOAD_PATH, `explorer href = ${explorer.cta.href}`)
      assert(explorer.cta.href === '/download', `explorer href not /download: ${explorer.cta.href}`)
    },
  ],

  // ── The config file itself hardcodes NO store URL (badges own that binding) ──
  [
    'no tab CTA hardcodes an App Store / Play / store URL',
    () => {
      for (const tab of LINKS_TABS) {
        const href = tab.cta.href
        assert(!/apps\.apple\.com/.test(href), `${tab.id} CTA hardcodes App Store: ${href}`)
        assert(!/play\.google\.com/.test(href), `${tab.id} CTA hardcodes Play: ${href}`)
        // The live store URLs must never be pasted into the config — they live in
        // lib/store-links.ts and are resolved per device by the /download route.
        assert(href !== APP_STORE_URL, `${tab.id} CTA equals APP_STORE_URL`)
        assert(href !== PLAY_STORE_URL, `${tab.id} CTA equals PLAY_STORE_URL`)
      }
    },
  ],

  // ── Business CTA → usemingla.com/business, derived from the shared constant ──
  [
    'Business CTA targets the shared /business path (usemingla.com/business)',
    () => {
      const biz = LINKS_TABS.find((t) => t.id === 'business')!
      assert(biz.cta.href === LINKS_BUSINESS_PATH, `business href = ${biz.cta.href}`)
      assert(LINKS_BUSINESS_PATH === BUSINESS_PATH, 'links business path drifted from subdomain BUSINESS_PATH')
      assert(biz.cta.href === '/business', `business href not /business: ${biz.cta.href}`)
    },
  ],

  // ── Socials: the full seven @usemingla profiles ─────────────────────────────
  [
    'exposes the seven usemingla social profiles with exact URLs',
    () => {
      const byLabel = Object.fromEntries(LINKS_SOCIALS.map((s) => [s.label, s.href]))
      assert(byLabel['Instagram'] === 'https://www.instagram.com/usemingla', `IG: ${byLabel['Instagram']}`)
      assert(byLabel['X'] === 'https://x.com/usemingla', `X: ${byLabel['X']}`)
      assert(byLabel['TikTok'] === 'https://www.tiktok.com/@usemingla', `TikTok: ${byLabel['TikTok']}`)
      assert(byLabel['YouTube'] === 'https://www.youtube.com/@usemingla', `YouTube: ${byLabel['YouTube']}`)
      assert(byLabel['LinkedIn'] === 'https://www.linkedin.com/company/usemingla', `LinkedIn: ${byLabel['LinkedIn']}`)
      assert(byLabel['Facebook'] === 'https://www.facebook.com/usemingla', `Facebook: ${byLabel['Facebook']}`)
      assert(byLabel['Threads'] === 'https://www.threads.com/@usemingla', `Threads: ${byLabel['Threads']}`)
      assert(LINKS_SOCIALS.length === 7, `expected 7 socials, got ${LINKS_SOCIALS.length}`)
    },
  ],
  [
    'every social URL is an absolute https:// link (opens safely in a new tab)',
    () => {
      for (const s of LINKS_SOCIALS) {
        assert(/^https:\/\//.test(s.href), `${s.label} is not https: ${s.href}`)
      }
    },
  ],

  // ── Surface-aware socials: the Business tab swaps the 5 business-branded ─────
  // networks to @minglabusiness; YouTube & LinkedIn stay universal on both tabs.
  [
    'Business tab swaps IG/X/TikTok/Facebook/Threads to @minglabusiness handles',
    () => {
      const byLabel = Object.fromEntries(LINKS_SOCIALS.map((s) => [s.label, s]))
      const biz = (label: string) => socialHref(byLabel[label], 'business')
      assert(biz('Instagram') === 'https://www.instagram.com/minglabusiness', `IG biz: ${biz('Instagram')}`)
      assert(biz('X') === 'https://x.com/MinglaBusiness', `X biz: ${biz('X')}`)
      assert(biz('TikTok') === 'https://www.tiktok.com/@minglabusiness', `TikTok biz: ${biz('TikTok')}`)
      assert(biz('Facebook') === 'https://www.facebook.com/minglabusiness', `FB biz: ${biz('Facebook')}`)
      assert(biz('Threads') === 'https://www.threads.com/@minglabusiness', `Threads biz: ${biz('Threads')}`)
    },
  ],
  [
    'YouTube & LinkedIn stay @usemingla on BOTH tabs (no business variant)',
    () => {
      const byLabel = Object.fromEntries(LINKS_SOCIALS.map((s) => [s.label, s]))
      for (const label of ['YouTube', 'LinkedIn']) {
        const s = byLabel[label]
        assert(s.businessHref === undefined, `${label} must not define a businessHref`)
        assert(socialHref(s, 'business') === s.href, `${label} must stay universal on business tab`)
        assert(socialHref(s, 'explorer') === s.href, `${label} must be universal on explorer tab`)
      }
    },
  ],
  [
    'Explorer tab always resolves to the universal @usemingla href',
    () => {
      for (const s of LINKS_SOCIALS) {
        assert(socialHref(s, 'explorer') === s.href, `${s.label} explorer href drifted: ${socialHref(s, 'explorer')}`)
      }
    },
  ],
  [
    'every business handle is also an absolute https:// link',
    () => {
      for (const s of LINKS_SOCIALS) {
        if (s.businessHref !== undefined) {
          assert(/^https:\/\//.test(s.businessHref), `${s.label} business is not https: ${s.businessHref}`)
        }
      }
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1317 /links data contract (guard)', () => {
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
  console.log(`\nAll ${cases.length} links-config tests passed`)
}
