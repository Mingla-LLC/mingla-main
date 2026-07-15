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
  LINKS_BUSINESS_DOWNLOAD_PATH,
  socialHref,
  socialsForTab,
  type LinksSocial,
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

  // ── Business CTA → the device-smart /business/download route (ORCH-1326) ─────
  // The business app is live on the App Store; the CTA now routes per device
  // (iPhone → business App Store, else → business.usemingla.com) via the new
  // /business/download server route — NOT the bare /business marketing page.
  [
    'Business CTA targets the device-smart /business/download route (ORCH-1326)',
    () => {
      const biz = LINKS_TABS.find((t) => t.id === 'business')!
      assert(biz.cta.href === LINKS_BUSINESS_DOWNLOAD_PATH, `business href = ${biz.cta.href}`)
      assert(biz.cta.href === '/business/download', `business href not /business/download: ${biz.cta.href}`)
      assert(biz.cta.href !== '/business', 'business CTA must NOT be the bare /business page (app is live)')
      assert(biz.cta.destination === 'business_download', `business destination = ${biz.cta.destination}`)
      // The /business surface path constant still derives from the shared source.
      assert(LINKS_BUSINESS_PATH === BUSINESS_PATH, 'links business path drifted from subdomain BUSINESS_PATH')
    },
  ],

  // ── Socials: the full EIGHT @usemingla profiles (ORCH-1382 added Snapchat) ──
  [
    'exposes the eight usemingla social profiles with exact URLs',
    () => {
      const byLabel = Object.fromEntries(LINKS_SOCIALS.map((s) => [s.label, s.href]))
      assert(byLabel['Instagram'] === 'https://www.instagram.com/usemingla', `IG: ${byLabel['Instagram']}`)
      assert(byLabel['X'] === 'https://x.com/usemingla', `X: ${byLabel['X']}`)
      assert(byLabel['TikTok'] === 'https://www.tiktok.com/@usemingla', `TikTok: ${byLabel['TikTok']}`)
      assert(byLabel['YouTube'] === 'https://www.youtube.com/@usemingla', `YouTube: ${byLabel['YouTube']}`)
      assert(byLabel['LinkedIn'] === 'https://www.linkedin.com/company/usemingla', `LinkedIn: ${byLabel['LinkedIn']}`)
      assert(byLabel['Facebook'] === 'https://www.facebook.com/usemingla', `Facebook: ${byLabel['Facebook']}`)
      assert(byLabel['Threads'] === 'https://www.threads.com/@usemingla', `Threads: ${byLabel['Threads']}`)
      assert(byLabel['Snapchat'] === 'https://www.snapchat.com/add/usemingla', `Snapchat: ${byLabel['Snapchat']}`)
      assert(LINKS_SOCIALS.length === 8, `expected 8 socials, got ${LINKS_SOCIALS.length}`)
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
  // ── T-8 NEUTRAL — investor & education, neither explorer nor business ───────
  // RETARGETED BY ORCH-1382 [TEST-MOD-APPROVED ORCH-1382]: neutrality is no longer
  // modelled by the ABSENCE of businessHref (which was indistinguishable from
  // explorer_only) but by an explicit scope. Same angle, now unambiguous.
  [
    'T-8: YouTube & LinkedIn are scope:neutral — same @usemingla href on BOTH tabs',
    () => {
      const byLabel = Object.fromEntries(LINKS_SOCIALS.map((s) => [s.label, s]))
      for (const label of ['YouTube', 'LinkedIn']) {
        const s = byLabel[label]
        assert(s.scope === 'neutral', `${label} must be scope:'neutral', got '${s.scope}'`)
        assert(socialHref(s, 'business') === s.href, `${label} must stay universal on business tab`)
        assert(socialHref(s, 'explorer') === s.href, `${label} must be universal on explorer tab`)
        assert(
          socialHref(s, 'business') === socialHref(s, 'explorer'),
          `${label} is neutral — it must resolve to the SAME href on both tabs`,
        )
      }
    },
  ],
  // ── T-8 ⭐ THE D+E COUPLING BUG — Snapchat must NOT leak onto Business ──────
  // THE defect this ORCH exists to prevent. Under the old optional-field model,
  // Snapchat (explorer_only) and YouTube (neutral) were byte-identical in the data,
  // so Snapchat would have rendered on the BUSINESS tab pointing at the CONSUMER
  // handle — a silent bug that looks exactly like correct data entry.
  [
    'T-8: Snapchat is explorer_only — present on Explorer, ABSENT from Business',
    () => {
      const explorer = socialsForTab('explorer')
      const business = socialsForTab('business')
      const snapExplorer = explorer.find((s) => s.label === 'Snapchat')
      assert(snapExplorer !== undefined, 'Snapchat is missing from the Explorer socials')
      assert(snapExplorer!.scope === 'explorer_only', `Snapchat must be scope:'explorer_only', got '${snapExplorer!.scope}'`)
      assert(
        snapExplorer!.href === 'https://www.snapchat.com/add/usemingla',
        `Snapchat href drifted: ${snapExplorer!.href}`,
      )
      assert(
        business.find((s) => s.label === 'Snapchat') === undefined,
        'SNAPCHAT LEAKED ONTO THE BUSINESS TAB — there is NO business Snapchat account, so this links owners at the consumer handle. This is the exact D+E coupling defect the scope discriminator exists to prevent.',
      )
      // No explorer_only member may EVER survive the business filter.
      for (const s of business) {
        assert(
          s.scope !== 'explorer_only',
          `${s.label} is explorer_only but renders on the Business tab — socialsForTab is not filtering`,
        )
      }
    },
  ],
  // ── T-8 the counts: Explorer 8, Business 7 ─────────────────────────────────
  [
    'T-8: socialsForTab returns 8 on Explorer and 7 on Business',
    () => {
      assert(socialsForTab('explorer').length === 8, `explorer socials = ${socialsForTab('explorer').length}, expected 8`)
      assert(socialsForTab('business').length === 7, `business socials = ${socialsForTab('business').length}, expected 7`)
      assert(
        socialsForTab('explorer').length === socialsForTab('business').length + 1,
        'the explorer/business social counts no longer differ by exactly one (Snapchat)',
      )
    },
  ],
  // ── T-8 per_surface entries always carry a real business handle ─────────────
  [
    'T-8: every per_surface social has a business handle that actually differs',
    () => {
      for (const s of LINKS_SOCIALS) {
        if (s.scope === 'per_surface') {
          assert(/^https:\/\//.test(s.businessHref), `${s.label} businessHref is not https: ${s.businessHref}`)
          assert(
            s.businessHref !== s.href,
            `${s.label} is per_surface but its business handle EQUALS the consumer one — it should be scope:'neutral' instead`,
          )
          assert(
            socialHref(s, 'business') === s.businessHref,
            `${s.label} does not swap to its business handle on the business tab`,
          )
        }
      }
    },
  ],
  // ── T-8 COMPILE-TIME — the union is what makes the invariant structural ────
  // These are deliberate NEGATIVE checks: each @ts-expect-error FAILS THE BUILD if
  // the union ever stops rejecting the shape it names. That is the difference
  // between a rule someone remembers and one the compiler enforces.
  [
    'T-8: the LinksSocial union rejects malformed entries at COMPILE time',
    () => {
      // @ts-expect-error — a per_surface social MUST carry a businessHref.
      const missingBusinessHref: LinksSocial = { scope: 'per_surface', label: 'X', href: 'https://x.com/a' }
      // @ts-expect-error — a neutral social must NOT carry a businessHref.
      const neutralWithBusiness: LinksSocial = { scope: 'neutral', label: 'Y', href: 'https://y.com/a', businessHref: 'https://y.com/b' }
      // @ts-expect-error — an explorer_only social must NOT carry a businessHref.
      const explorerOnlyWithBusiness: LinksSocial = { scope: 'explorer_only', label: 'Z', href: 'https://z.com/a', businessHref: 'https://z.com/b' }
      // @ts-expect-error — scope is required; modelling-by-omission is gone.
      const noScope: LinksSocial = { label: 'W', href: 'https://w.com/a' }
      // @ts-expect-error — an unknown scope is not assignable.
      const badScope: LinksSocial = { scope: 'business_only', label: 'V', href: 'https://v.com/a' }
      void missingBusinessHref
      void neutralWithBusiness
      void explorerOnlyWithBusiness
      void noScope
      void badScope
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
