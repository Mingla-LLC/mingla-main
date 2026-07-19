// ---------------------------------------------------------------
// ORCH-1324 [business "Get the app" → device-aware] — TESTER-ADVERSARIAL test.
// REWRITTEN BY ORCH-1381 [business-getapp-android-choice].
//
// WHAT CHANGED AND WHY. Block (b) used to REQUIRE the ternary
// `? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` and the non-iOS store label
// 'business_web'. That was the ORCH-1324 contract — it is now THE BUG. The
// business Play listing went live 2026-07-15 (COMMS-0101), so routing every
// non-iOS owner to the web app silently denies Android owners the app. Block (b)
// is INVERTED: the ternary is now asserted ABSENT.
//
// Different angle than the happy-path (which proves PRESENCE). This proves the
// ABSENCE of the failure modes:
//   (a) the retired beta funnel is gone — neither glass-nav's business branch nor
//       the hero imports the beta lead modal or its transport, nor renders the
//       beta CTA label / email input / beta subcopy / open-state setter (the token
//       list below is built from fragments so this file itself is grep-clean).
//   (b) the ORCH-1324 collapsed ternary is GONE from both surfaces, and neither
//       re-derives a destination locally: both delegate to resolveBusinessAppTarget
//       and offer BOTH actions. No surface may hand-write the note.
//   (c) the BUSINESS surface opens NO desktop QR panel — AppQrPanel / setQrOpen
//       never appears in the ORGANISER handlers / CTA branch or the hero. (Scoped:
//       the glass-nav EXPLORER branch legitimately KEEPS AppQrPanel/setQrOpen, so
//       this is NOT a whole-file grep of glass-nav.)
//
// Run from mingla-marketing/ via the repo tsc+node pattern:
//   npx tsc components/marketing/__tests__/business-getapp-cta.tester.test.ts \
//     --outDir /tmp/o --module commonjs --target es2020 --moduleResolution node \
//     && node /tmp/o/business-getapp-cta.tester.test.js
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'

const NAV = path.resolve(process.cwd(), 'components/marketing/glass-nav.tsx')
const HERO = path.resolve(
  process.cwd(),
  'components/sections/organiser-home/hero.tsx',
)

// Comment-strip both targets (mirrors the ORCH-1324 strict-grep guard): the
// informative code comments legitimately NAME the retired funnel (e.g. the beta
// lead-modal mount that ORCH-1324 removed) — the ABSENCE assertions below must
// scan CODE only, exactly like the guard, so those breadcrumbs never trip.
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const nav = stripComments(fs.readFileSync(NAV, 'utf8'))
const hero = stripComments(fs.readFileSync(HERO, 'utf8'))

// The business handler bodies only (never the explorer handler). ORCH-1381 split
// the single business handler into one per action.
const scopeHandler = (src: string, name: string): string => {
  const i = src.indexOf(`${name} = `)
  if (i === -1) return ''
  const rest = src.slice(i)
  const end = rest.indexOf('\n  }')
  return end === -1 ? rest.slice(0, 700) : rest.slice(0, end)
}
const navDownloadHandler = scopeHandler(nav, 'handleDownloadTheBusinessApp')
const navWebHandler = scopeHandler(nav, 'handleUseBusinessOnWeb')
const navHandler = navDownloadHandler + '\n' + navWebHandler

// The organiser CTA JSX branch only (from its `surface === 'organiser'` marker to
// the `) : (` that opens the explorer branch) — so the explorer AppQrPanel wiring
// is never in scope.
const navOrganiserCtaBranch = (() => {
  const btn = nav.indexOf('onClick={handleDownloadTheBusinessApp}')
  if (btn === -1) return ''
  const start = nav.lastIndexOf("surface === 'organiser'", btn)
  const end = nav.indexOf(') : (', btn)
  return start !== -1 && end !== -1 ? nav.slice(start, end) : ''
})()

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

// The beta-funnel tokens that must NEVER appear in the business CTA surfaces.
// The first five are built from fragments so the literal strings never appear in
// THIS test file — the §4.3 beta-funnel-removal grep must return zero hits across
// all of mingla-marketing (test files included). `frag` re-joins them at runtime,
// so a reverted CTA (the real beta lead-modal JSX / its transport import) still fires.
const frag = (...parts: string[]): RegExp => new RegExp(parts.join(''))
const BETA_TOKENS: ReadonlyArray<RegExp> = [
  frag('Beta', 'AccessModal'),
  frag('beta', '-access-modal'),
  frag('beta', '-access-submit'),
  frag('Get ', 'Beta Access'),
  frag('Free during ', 'beta'),
  /type="email"/,
  /setBetaOpen/,
  /betaOpen/,
]

const cases: ReadonlyArray<[string, () => void]> = [
  // ── (a) the beta funnel is gone from both surfaces ──────────────────────────
  [
    'nav: contains none of the retired beta-funnel tokens',
    () => {
      for (const re of BETA_TOKENS) {
        assert(!re.test(nav), `nav still contains a retired beta-funnel token: ${re}`)
      }
    },
  ],
  [
    'hero: contains none of the retired beta-funnel tokens',
    () => {
      for (const re of BETA_TOKENS) {
        assert(!re.test(hero), `hero still contains a retired beta-funnel token: ${re}`)
      }
    },
  ],
  // ── (b) INVERTED by ORCH-1381 — the collapsed ternary is now THE BUG ─────────
  [
    'nav: the ORCH-1324 collapsed ternary is ABSENT and the decision is delegated',
    () => {
      assert(navDownloadHandler.length > 0, 'handleDownloadTheBusinessApp handler not found in nav')
      assert(navWebHandler.length > 0, 'handleUseBusinessOnWeb handler not found in nav')
      assert(
        !/platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/.test(nav),
        'nav still carries the ORCH-1324 collapsed ternary — it sends every Android owner to the web app instead of the LIVE business Play listing (COMMS-0101)',
      )
      // The destination must not be re-derived locally at all.
      assert(
        !/BUSINESS_APP_STORE_URL/.test(nav) && !/BUSINESS_WEB_URL/.test(nav),
        'nav re-derives a business destination locally — the decision belongs ONLY to lib/business-app-target (that triplication is what left 4 surfaces stale when the Play listing went live)',
      )
      // RETARGETED BY ORCH-1399 [TEST-MOD-APPROVED ORCH-1399]. WAS: BOTH handlers
      // must call resolveBusinessAppTarget(. Since ORCH-1399 the handlers no longer
      // NAVIGATE — the anchors do — so the use-on-web handler has no destination left
      // to resolve (its href={target.webHref} is resolved once at render). Requiring a
      // now-purposeless call would mandate dead code.
      //
      // THE ANGLE IS PRESERVED EXACTLY: the destination decision must come from the ONE
      // module and never be re-derived on this surface. It is simply asserted where the
      // decision now lives — at the render-level resolve, plus the download handler,
      // which still resolves fresh so its analytics `store` label cannot go stale.
      assert(
        /const businessTarget = resolveBusinessAppTarget\(/.test(nav),
        'nav does not resolve its business destinations via resolveBusinessAppTarget( at render — the anchors would have no href from the ONE decision module',
      )
      assert(
        /resolveBusinessAppTarget\(/.test(navDownloadHandler),
        'the nav download handler does not re-resolve via resolveBusinessAppTarget( — its analytics `store` label would go stale against the real device',
      )
      // And the decision must carry attribution wherever it is made.
      assert(
        /resolveBusinessAppTarget\(\s*[^),]+,\s*[^)]+\)/.test(nav),
        'nav calls resolveBusinessAppTarget( with a bare 1-arg call — an unattributed OneLink works perfectly and reports nothing (ORCH-1399 §5.2.4)',
      )
      assert(/action: 'download'/.test(navDownloadHandler), "nav download handler missing action: 'download'")
      assert(/action: 'use_web'/.test(navWebHandler), "nav web handler missing action: 'use_web'")
    },
  ],
  [
    'hero: the ORCH-1324 collapsed ternary is ABSENT and the decision is delegated',
    () => {
      assert(
        !/platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/.test(hero),
        'hero still carries the ORCH-1324 collapsed ternary — it sends every Android owner to the web app instead of the LIVE business Play listing (COMMS-0101)',
      )
      assert(
        !/BUSINESS_APP_STORE_URL/.test(hero) && !/BUSINESS_WEB_URL/.test(hero),
        'hero re-derives a business destination locally — the decision belongs ONLY to lib/business-app-target',
      )
      assert(/resolveBusinessAppTarget\(/.test(hero), 'hero does not delegate to resolveBusinessAppTarget')
      assert(/action: 'download'/.test(hero), "hero missing action: 'download'")
      assert(/action: 'use_web'/.test(hero), "hero missing action: 'use_web'")
    },
  ],
  // ── (b2) the note is a shared CLAIM, never hand-written ─────────────────────
  [
    'nav + hero render the note/labels from BUSINESS_APP_CHOICE_COPY only',
    () => {
      assert(/BUSINESS_APP_CHOICE_COPY/.test(nav), 'nav hand-writes its CTA labels instead of using BUSINESS_APP_CHOICE_COPY')
      assert(/BUSINESS_APP_CHOICE_COPY/.test(hero), 'hero hand-writes its CTA labels/note instead of using BUSINESS_APP_CHOICE_COPY')
      // The claim must not be widened. "check guests in" would be FALSE — manual
      // check-in is NOT platform-gated (it exists on web, device-local).
      for (const [label, src] of [['nav', nav], ['hero', hero]] as const) {
        assert(
          !/check guests in/i.test(src),
          `${label} claims the app is needed to "check guests in" — FALSE: manual check-in exists on web (it is device-local only). The verified claim is "scan tickets at the door".`,
        )
      }
    },
  ],
  // ── (b3) no dead / consumer-owned OneLink on either surface ─────────────────
  [
    'nav + hero route through NO dead or consumer-owned OneLink',
    () => {
      for (const [label, src] of [['nav', nav], ['hero', hero]] as const) {
        assert(
          !/minglabiz\.onelink\.me/.test(src),
          `${label} references minglabiz.onelink.me — DEAD on Android (AppsFlyer Pending, COMMS-0101)`,
        )
        assert(
          !/go\.usemingla\.com/.test(src),
          `${label} references go.usemingla.com — consumer-owned (ORCH-1346: 1 domain = 1 template)`,
        )
      }
    },
  ],
  // ── (c) NO QR panel on the business surface (scoped, not whole-file) ─────────
  [
    'nav business handler + organiser CTA branch open NO desktop QR panel',
    () => {
      assert(navHandler.length > 0, 'handleGetTheBusinessApp handler not found in nav')
      assert(navOrganiserCtaBranch.length > 0, 'organiser CTA branch not found in nav')
      assert(!/AppQrPanel/.test(navHandler), 'nav business handler references AppQrPanel')
      assert(!/setQrOpen/.test(navHandler), 'nav business handler calls setQrOpen (QR panel)')
      assert(!/AppQrPanel/.test(navOrganiserCtaBranch), 'organiser CTA branch mounts AppQrPanel')
      assert(!/setQrOpen/.test(navOrganiserCtaBranch), 'organiser CTA branch opens the QR panel (setQrOpen)')
    },
  ],
  [
    'hero opens NO desktop QR panel',
    () => {
      assert(!/AppQrPanel/.test(hero), 'hero references AppQrPanel')
      assert(!/setQrOpen/.test(hero), 'hero calls setQrOpen (QR panel)')
    },
  ],
  // ── Sanity: the explorer branch is UNTOUCHED (AppQrPanel still present) ──────
  // Proves the scoping above is real — glass-nav as a whole still keeps the
  // explorer QR wiring; only the business surface is QR-free.
  [
    'nav: the explorer branch still keeps AppQrPanel/setQrOpen (scoping is real)',
    () => {
      assert(/AppQrPanel/.test(nav), 'glass-nav lost the explorer AppQrPanel (explorer branch broken)')
      assert(/setQrOpen/.test(nav), 'glass-nav lost the explorer setQrOpen wiring')
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1324 business Get-the-app CTA (adversarial)', () => {
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
  console.log(`\nAll ${cases.length} business-getapp adversarial tests passed`)
}
