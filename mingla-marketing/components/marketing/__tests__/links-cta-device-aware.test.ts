// ---------------------------------------------------------------
// ORCH-1328 [links-cta-soft-nav-blank-page] — HAPPY-PATH regression test.
//
// Proves the /links per-tab CTA is a device-aware client <button> that opens the
// store/web app DIRECTLY on the tap (so /links stays mounted) — NOT the old Next
// <Link> soft-navigation into the /download|/host/download external-redirect
// route (which stranded the tab on a blank Explorer / footer-only Business shell —
// INVESTIGATION_ORCH-1328). Asserts PRESENCE in links-experience.tsx:
//   - detectClientPlatform imported; all four store consts referenced.
//   - the CTA is a <button type="button"> bound to onClick={() => onCtaClick(activeTab)}.
//   - the tap routes through openExternal( AND that helper still guards the tap
//     (RE-POINTED by ORCH-1381 ADDENDUM D-B — see the case comment below).
//   - the per-tab branch tab.id === 'business' present.
//   - links_page_cta_clicked fired.
//   - the button keeps the recipe cn(CTA_BASE, CTA_INTENT[activeTab.cta.intent]).
//
// The marketing package has NO jest/vitest runner wired — this is a SOURCE-level
// pin run via the repo's tsc+node pattern (mirrors links-tab-switcher.test.ts),
// EXCEPT the openExternal fallback case, which is genuinely behavioural: it drives
// the imported helper against a fake Window (the helper is React-free and takes an
// injectable window precisely so this is possible with no DOM test infra).
//
// Comment-stripped ONLY for the absence assertions (`srcNoComments`) — the file's
// own informative comments legitimately NAME window.open, so a raw-source absence
// check would trip on prose. Presence assertions still read the raw source.
//
// Run from mingla-marketing/ (the openExternal import roots the emit at the package,
// so the runnable JS lands under components/marketing/__tests__/):
//   npx tsc components/marketing/__tests__/links-cta-device-aware.test.ts \
//     --outDir /tmp/o --module commonjs --target es2020 --moduleResolution node \
//     --skipLibCheck \
//     && node /tmp/o/components/marketing/__tests__/links-cta-device-aware.test.js
//
// Fails-on-revert: restoring the <Link href={activeTab.cta.href}> CTA deletes
// <button / openExternal(, so those assertions throw. Deleting the popup-block
// fallback inside lib/open-external.ts turns the behavioural case red. Inlining
// window.open( back into this component turns the anti-bypass assertion red.
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'

import { openExternal } from '../../../lib/open-external'

const CTA = path.resolve(
  process.cwd(),
  'components/marketing/links-experience.tsx',
)

const src = fs.readFileSync(CTA, 'utf8')

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// Absence assertions read THIS, never `src` — the component's own docblock names
// window.open in prose, which would trip a raw-source absence check.
const srcNoComments = stripComments(src)

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

// ── behavioural harness for the delegated open+fallback ──────────────────────
// The old `window.open(`/`window.location.assign(` greps on this component went
// red when ORCH-1381 ADDENDUM D-B extracted both tokens into lib/open-external.
// The guarantee they protected did not move — so the guard follows it here rather
// than being deleted.
//
// The fake Window models the browser-verified HTML rule (ADDENDUM §4.2, Chromium):
// a feature string containing noopener OR noreferrer makes open() return null EVEN
// ON SUCCESS. That null return is what made the "popup-blocked fallback" fire on
// every tap. Modelling it is what lets this catch the half-fix that drops only
// 'noopener' and keeps 'noreferrer' (which alone also returns null — ADDENDUM C-4).
const DEST = 'https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness'

interface DriveResult {
  opened: number
  assigned: string[]
  features: string
}

function driveOpenExternal({ popupBlocked }: { popupBlocked: boolean }): DriveResult {
  const opened: string[] = []
  const assigned: string[] = []
  let features = ''
  const w = {
    open(url: string, _target?: string, f = ''): unknown {
      opened.push(url)
      features = f
      if (popupBlocked) return null
      if (/\bnoopener\b|\bnoreferrer\b/.test(f)) return null
      return { opener: {} as unknown }
    },
    location: {
      assign: (u: string): void => {
        assigned.push(u)
      },
    },
  }
  openExternal(DEST, w as unknown as Window)
  return { opened: opened.length, assigned, features }
}

/**
 * The behavioural half of the re-pointed fallback guard: the tap this component
 * delegates cannot become a dead tap, and cannot double-navigate.
 */
function assertDelegatedTapIsStillGuarded(): void {
  // NO DEAD TAP (Constitution #1) — this is precisely what the old
  // `window.location.assign(` grep existed to protect.
  const blocked = driveOpenExternal({ popupBlocked: true })
  assert(
    blocked.assigned.length === 1 && blocked.assigned[0] === DEST,
    `openExternal does not fall back when the popup is genuinely blocked ` +
      `(assigned=${JSON.stringify(blocked.assigned)}) — the CTA tap would be a DEAD TAP. ` +
      `This is the guarantee the old window.location.assign( presence grep protected; ` +
      `the fallback moved to lib/open-external.ts, the requirement did not.`,
  )
  // NO DOUBLE-NAV — a successful open must not also destroy the current page,
  // which is ORCH-1328's own "/links stays mounted" contract.
  const ok = driveOpenExternal({ popupBlocked: false })
  assert(ok.opened === 1, `expected exactly 1 window.open call, got ${ok.opened}`)
  assert(
    ok.assigned.length === 0,
    `DOUBLE NAVIGATION — a successful open ALSO navigated the current tab to ` +
      `"${ok.assigned[0]}" (features="${ok.features}"). /links does NOT stay mounted. ` +
      `A noopener/noreferrer feature string makes open() return null even on success, ` +
      `firing the fallback unconditionally (ORCH-1381 ADDENDUM D-B).`,
  )
}

const cases: ReadonlyArray<[string, () => void]> = [
  [
    'detectClientPlatform is imported (device-aware store choice)',
    () => {
      assert(/detectClientPlatform/.test(src), 'CTA no longer imports/calls detectClientPlatform')
    },
  ],
  // RETARGETED BY ORCH-1399 [TEST-MOD-APPROVED ORCH-1399]. WAS: requires the raw
  // APP_STORE_URL/PLAY_STORE_URL consts. The explorer CTA now resolves an ATTRIBUTED
  // OneLink through resolveExplorerAppTarget (the ORCH-1381 decision-module pattern,
  // extended to explorer — the same ternary was duplicated in glass-nav AND here), so
  // requiring the raw consts would fail the CORRECT implementation. Angle preserved:
  // BOTH decisions must be delegated, never re-derived on this surface.
  [
    'BOTH decisions are delegated to their ONE module (explorer + business)',
    () => {
      assert(
        /resolveExplorerAppTarget\(/.test(src),
        'the explorer branch does not delegate to resolveExplorerAppTarget (the ONE explorer decision module)',
      )
      assert(
        /resolveBusinessAppTarget\(/.test(src),
        'the business branch does not delegate to resolveBusinessAppTarget (the ONE decision module)',
      )
      // The destinations must not be re-derived here at all.
      assert(
        !/\bAPP_STORE_URL\b/.test(srcNoComments) && !/\bPLAY_STORE_URL\b/.test(srcNoComments),
        'links-experience re-derives an explorer store const locally — that duplication is exactly what ORCH-1399 removed, and a raw store URL also re-introduces the intermediate Play web page + drops attribution',
      )
    },
  ],
  // ── ORCH-1399 T-9 ⭐ THE ANCHOR CONTRACT ────────────────────────────────────
  [
    'T-9: the store/web CTAs are real <a href> anchors with target=_blank and rel=noopener',
    () => {
      // A real link is the ONE navigation primitive that survives the Instagram /
      // TikTok in-app webviews that dominate /links traffic — window.open is
      // routinely blocked there, which is why the CTA became an anchor.
      assert(
        /<a\s+[^>]*href=\{[^}]*installHref[^}]*\}/.test(srcNoComments),
        'the install CTA is not a real <a href={…installHref…}> anchor',
      )
      assert(
        /<a\s+[^>]*href=\{[^}]*webHref[^}]*\}/.test(srcNoComments),
        'the use-on-web CTA is not a real <a href={…webHref…}> anchor',
      )
      // ⚠ PER-ANCHOR, NOT FILE-LEVEL — this distinction is load-bearing.
      // A file-level `/rel="noopener/` assertion on THIS file is DECORATIVE: the
      // socials row has carried rel="noopener noreferrer" since ORCH-1317, so it
      // passes even when EVERY CTA anchor has lost its rel. (Found by actually
      // running the fails-on-revert proof — the assertion did not fail when all
      // three CTA rels were stripped. Same bug class as orch-1328's /<button/
      // matching the tablist.) So each CTA anchor is extracted and checked alone.
      const ctaAnchors = [...srcNoComments.matchAll(/<a\s[\s\S]*?>/g)]
        .map((m) => m[0])
        .filter((a) => /installHref|webHref/.test(a))
      assert(ctaAnchors.length >= 3, `expected >=3 CTA anchors (business install + business web + explorer install), found ${ctaAnchors.length}`)
      for (const a of ctaAnchors) {
        const shape = a.replace(/\s+/g, ' ').slice(0, 64)
        assert(
          /target="_blank"/.test(a),
          `a CTA anchor lost target="_blank" — /links must stay mounted and the analytics capture must survive the tap. Anchor: ${shape}…`,
        )
        // ⚠ THE §5.1 TRAP: rel="noopener" on an <a> is REQUIRED and is NOT the
        // ORCH-1381 window.open pathology (that ban is scoped to .open( FEATURE
        // STRINGS). An implementor "complying" with ORCH-1381 by stripping rel here
        // would ship a real reverse-tabnabbing regression.
        assert(
          /rel="noopener/.test(a),
          `a CTA anchor lost rel="noopener" — reverse-tabnabbing. The ORCH-1381 noopener ban is scoped to window.open FEATURE STRINGS; on an <a> element rel="noopener" is MANDATORY. Anchor: ${shape}…`,
        )
      }
    },
  ],
  // ── ORCH-1399 T-9 — attribution actually rides ─────────────────────────────
  [
    'T-9: the CTA hrefs carry attribution (a bare OneLink reports nothing)',
    () => {
      assert(
        /linksAttribution\(/.test(srcNoComments),
        'links-experience does not build a linksAttribution( — the OneLink would fall back to the template default and every bio install stays anonymous, which is the entire bug ORCH-1399 fixes',
      )
      assert(
        /'explorer_bio'/.test(srcNoComments) && /'business_bio'/.test(srcNoComments),
        "both tab campaigns ('explorer_bio' | 'business_bio') must be set from the TAB, not from src",
      )
    },
  ],
  // ── ORCH-1399 T-9 — `src` is a PAGE-level prop, not tab state ──────────────
  [
    'T-9: src is a component PROP (so a tab switch cannot structurally lose it)',
    () => {
      assert(
        /src\?:\s*string/.test(srcNoComments) || /src = LINKS_SRC_FALLBACK/.test(srcNoComments),
        'src is not a prop with a fail-safe default — if it were tab state, switching tabs could silently drop the attribution (SPEC §4.4)',
      )
      assert(
        !/useSearchParams/.test(srcNoComments),
        'links-experience reads useSearchParams() — src must be resolved ONCE on the server and passed down (SPEC §4.5): a client-only read needs a Suspense boundary and flickers on first paint',
      )
    },
  ],
  // ── ORCH-1399 T-10 — the px-4 patch must not creep back ────────────────────
  [
    'T-10: the ORCH-1381 D-A px-4 override is GONE and the pills are STACKED',
    () => {
      // D-A's px-4 existed ONLY because two w-full pills shared one row. Stacking
      // deleted that precondition, so px-7 (CTA_BASE) fits with room to spare.
      // Re-adding px-4 would silently shrink the pills for no reason.
      assert(
        !/'px-4'/.test(srcNoComments),
        "the business pills carry a 'px-4' override again — the ORCH-1381 ADDENDUM D-A patch is redundant once the pills stack full-width (they must render CTA_BASE's px-7)",
      )
      // The pills must be a COLUMN, not a row.
      assert(
        /flex flex-col items-center justify-center gap-2/.test(srcNoComments),
        'the two business actions are not stacked in a flex column — reverting to a side-by-side row re-creates the 360px overflow that forced the px-4 patch',
      )
    },
  ],
  // RETARGETED BY ORCH-1399 [TEST-MOD-APPROVED ORCH-1399]. WAS: the CTA must be a
  // <button type="button"> bound to onCtaClick. The store/web CTAs are anchors now
  // (see the T-9 anchor-contract case above); the DESKTOP QR CTA is still a real
  // <button>, because opening a PAGE is a genuinely different action from handing off
  // to a store app. Angle preserved: every CTA is a real control, correctly bound.
  [
    'the desktop QR CTA is still a native <button> and every action is bound',
    () => {
      assert(/<button/.test(srcNoComments), 'the desktop QR CTA is no longer a <button>')
      assert(/type="button"/.test(srcNoComments), 'the desktop QR CTA lacks type="button"')
      assert(!/role="button"/.test(srcNoComments), 'a role="button" (non-native) control is used — must be a real <button>')
      assert(
        /onClick=\{\(\) => onCtaDesktop\(activeTab\)\}/.test(srcNoComments),
        'the desktop CTA no longer binds onClick={() => onCtaDesktop(activeTab)} (the /download QR page is unreachable)',
      )
      assert(
        /onClick=\{\(\) => onCtaTrack\(activeTab, 'download'\)\}/.test(srcNoComments),
        "the business Download anchor is not bound to onCtaTrack(activeTab, 'download')",
      )
      assert(
        /onClick=\{\(\) => onCtaTrack\(activeTab, 'use_web'\)\}/.test(srcNoComments),
        "the business Use-on-web anchor is not bound to onCtaTrack(activeTab, 'use_web')",
      )
    },
  ],
  // ── RE-POINTED by ORCH-1381 ADDENDUM D-B. [TEST-MOD-APPROVED ORCH-1381] ──────
  // WAS: assert(/window\.open\(/.test(src)) + assert(/window\.location\.assign\(/.test(src)).
  // Those greps asserted WHERE the code lived, not WHAT it did. §5.3 legitimately
  // relocated both tokens into lib/open-external.ts (the ONE owner), so they went
  // red against a CORRECT implementation while the behaviour was intact.
  //
  // The guarantee — a blocked popup must never become a dead tap, and a successful
  // open must never double-navigate — is unchanged and still guarded, now as the
  // two-link chain it actually is:
  //   Link 1  this CTA routes the tap through openExternal( and hand-rolls neither
  //           window.open( nor .location.assign(. Inlining is exactly how the bug
  //           shipped to four surfaces, so bypassing the helper must fail here.
  //   Link 2  openExternal is DRIVEN against a fake Window (not grepped).
  //
  // Both directions are covered: delete the fallback in lib/open-external.ts →
  // Link 2 goes red; delete the openExternal( call or inline window.open( back into
  // this component → Link 1 goes red. Neither half can pass on the defect.
  [
    'opens the store client-side via openExternal — no dead tap, no double-nav',
    () => {
      // Link 1 — delegation, and no hand-rolled open on this surface.
      assert(
        /openExternal\(/.test(src),
        'CTA no longer opens the destination via openExternal( from lib/open-external — ' +
          'the tap gesture must route through the ONE owner of the open+fallback decision',
      )
      assert(
        !/window\.open\(/.test(srcNoComments),
        'CTA inlines window.open( instead of delegating to openExternal( — inlining is ' +
          'exactly how the double-navigation bug shipped to four surfaces (ORCH-1381 ADDENDUM D-B)',
      )
      assert(
        !/\.location\.assign\(/.test(srcNoComments),
        'CTA inlines a .location.assign( fallback instead of delegating to openExternal( — ' +
          'the popup-block decision must live in exactly ONE module',
      )
      // Link 2 — the delegated behaviour itself.
      assertDelegatedTapIsStillGuarded()
    },
  ],
  [
    'the per-tab branch tab.id === \'business\' is present (device-aware per surface)',
    () => {
      assert(/tab\.id === 'business'/.test(src), 'handler no longer branches on tab.id === \'business\'')
    },
  ],
  [
    'the links_page_cta_clicked analytics is preserved',
    () => {
      assert(/links_page_cta_clicked/.test(src), 'CTA no longer fires links_page_cta_clicked')
    },
  ],
  [
    'the CTA keeps the token recipe cn(CTA_BASE, CTA_INTENT[activeTab.cta.intent])',
    () => {
      assert(
        /cn\(CTA_BASE, CTA_INTENT\[activeTab\.cta\.intent\]\)/.test(src),
        'CTA lost the cn(CTA_BASE, CTA_INTENT[activeTab.cta.intent]) recipe (visual/focus-ring drift)',
      )
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1328 links CTA opens the store client-side (happy-path)', () => {
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
  console.log(`\nAll ${cases.length} links-cta-device-aware happy-path tests passed`)
}
