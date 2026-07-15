// ---------------------------------------------------------------
// ORCH-1324 [business "Get the app" → device-aware] — HAPPY-PATH regression test.
// REWRITTEN BY ORCH-1381 [business-getapp-android-choice].
//
// WHAT CHANGED AND WHY. This file used to REQUIRE the ternary
// `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` on both
// surfaces. That was the ORCH-1324 contract; it is now THE BUG — it sends every
// Android owner to the web app instead of the business Play listing, which went
// live 2026-07-15 (COMMS-0101). The ternary asserts are therefore INVERTED to
// asserted-ABSENT, and replaced with the shared-helper + two-action contract.
//
// Proves BOTH business CTAs (glass-nav.tsx organiser branch + the organiser hero)
// present the inline CHOICE: each delegates to resolveBusinessAppTarget() via
// detectClientPlatform(), renders BUSINESS_APP_CHOICE_COPY, fires
// get_the_app_clicked { surface:'organiser' } with the right `location` AND both
// `action: 'download'` / `action: 'use_web'`, and routes the tap through
// openExternal( so a blocked popup can never be a dead tap.
//
// The marketing package has NO jest/vitest runner wired — this is a SOURCE-level
// pin run via the repo's tsc+node pattern (mirrors lib/device-platform.test.ts),
// EXCEPT the two openExternal fallback cases, which are genuinely behavioural:
// they drive the imported helper against a fake Window (it is React-free and takes
// an injectable window precisely so this is possible with no DOM test infra).
//
// Comment-stripped ONLY for the absence assertions (`navNoComments` /
// `heroNoComments`) — both components' docblocks legitimately NAME window.open, so
// a raw-source absence check would trip on prose.
//
// Run from mingla-marketing/ (the openExternal import roots the emit at the
// package, so the runnable JS lands under components/marketing/__tests__/):
//   npx tsc components/marketing/__tests__/business-getapp-cta.test.ts \
//     --outDir /tmp/o --module commonjs --target es2020 --moduleResolution node \
//     --skipLibCheck \
//     && node /tmp/o/components/marketing/__tests__/business-getapp-cta.test.js
//
// Fails-on-revert: reverting either CTA to the ORCH-1324 single-action ternary
// removes the helper call + BUSINESS_APP_CHOICE_COPY + the action discriminators
// and re-introduces the banned ternary, so those assertions throw. Deleting the
// popup-block fallback inside lib/open-external.ts turns the two behavioural cases
// red. (The RUNTIME guard for the decision itself is
// lib/__tests__/business-app-target.test.ts T-1 — this file pins the wiring plus
// the delegated open behaviour.)
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'

import { openExternal } from '../../../lib/open-external'

const NAV = path.resolve(process.cwd(), 'components/marketing/glass-nav.tsx')
const HERO = path.resolve(
  process.cwd(),
  'components/sections/organiser-home/hero.tsx',
)

const nav = fs.readFileSync(NAV, 'utf8')
const hero = fs.readFileSync(HERO, 'utf8')

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// Absence assertions read THESE, never the raw source — both components' docblocks
// name window.open in prose, which would trip a raw-source absence check.
const navNoComments = stripComments(nav)
const heroNoComments = stripComments(hero)

// The business handler bodies in glass-nav, scoped so we never match the EXPLORER
// handler (which also fires get_the_app_clicked / location:'nav'). ORCH-1381 split
// the single business handler into two — one per action.
const scopeHandler = (src: string, name: string): string => {
  const i = src.indexOf(`${name} = `)
  if (i === -1) return ''
  const rest = src.slice(i)
  const end = rest.indexOf('\n  }')
  return end === -1 ? rest.slice(0, 700) : rest.slice(0, end)
}

const navDownloadHandler = scopeHandler(nav, 'handleDownloadTheBusinessApp')
const navWebHandler = scopeHandler(nav, 'handleUseBusinessOnWeb')
// Both business handlers together — for file-scoped business assertions that must
// not see the explorer handler.
const navHandler = navDownloadHandler + '\n' + navWebHandler

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

// ── behavioural harness for the delegated open+fallback ──────────────────────
// The nav's local `openBusinessDest` helper NO LONGER EXISTS: ORCH-1381 ADDENDUM
// D-B replaced it (and the three other copy-pasted twins) with the single
// lib/open-external.ts owner, because every one of those local copies carried the
// same double-navigation bug. The assertions that pinned `openBusinessDest` are
// therefore re-pointed at openExternal — the real delegate — and, crucially, they
// now DRIVE it rather than grep it.
//
// The fake Window models the browser-verified HTML rule (ADDENDUM §4.2, Chromium):
// a feature string containing noopener OR noreferrer makes open() return null EVEN
// ON SUCCESS. That null is what made the "popup-blocked fallback" fire on every
// tap. Modelling it is what lets this catch the half-fix that drops only 'noopener'
// and keeps 'noreferrer' (which alone also returns null — ADDENDUM C-4).
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
 * The behavioural half of the re-pointed fallback guards: the tap these business
 * CTAs delegate cannot become a dead tap, and cannot double-navigate.
 */
function assertDelegatedTapIsStillGuarded(): void {
  // NO DEAD TAP (Constitution #1) — precisely what the old
  // `window.location.assign(` presence greps existed to protect.
  const blocked = driveOpenExternal({ popupBlocked: true })
  assert(
    blocked.assigned.length === 1 && blocked.assigned[0] === DEST,
    `openExternal does not fall back when the popup is genuinely blocked ` +
      `(assigned=${JSON.stringify(blocked.assigned)}) — the business CTA would be a DEAD TAP. ` +
      `The fallback moved into lib/open-external.ts; the requirement did not move with it.`,
  )
  // NO DOUBLE-NAV — a successful open must not also destroy the marketing page.
  const ok = driveOpenExternal({ popupBlocked: false })
  assert(ok.opened === 1, `expected exactly 1 window.open call, got ${ok.opened}`)
  assert(
    ok.assigned.length === 0,
    `DOUBLE NAVIGATION — a successful open ALSO navigated the current tab to ` +
      `"${ok.assigned[0]}" (features="${ok.features}"). A noopener/noreferrer feature ` +
      `string makes open() return null even on success, firing the fallback ` +
      `unconditionally (ORCH-1381 ADDENDUM D-B).`,
  )
}

const cases: ReadonlyArray<[string, () => void]> = [
  // ── glass-nav organiser branch ──────────────────────────────────────────────
  [
    'nav: delegates to the shared decision helper + renders the shared copy',
    () => {
      assert(
        /resolveBusinessAppTarget\(/.test(nav),
        'nav does not call resolveBusinessAppTarget — the decision must come from the ONE module',
      )
      assert(
        /BUSINESS_APP_CHOICE_COPY/.test(nav),
        'nav does not render BUSINESS_APP_CHOICE_COPY (labels must not be hand-written)',
      )
    },
  ],
  [
    'nav: the ORCH-1324 collapsed ternary is GONE (it denied Android owners the app)',
    () => {
      assert(
        !/platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/.test(nav),
        'nav still carries the ORCH-1324 collapsed ternary — every Android owner would be sent to the web app instead of the LIVE business Play listing',
      )
    },
  ],
  [
    'nav: both business handlers resolve the platform via detectClientPlatform()',
    () => {
      assert(navDownloadHandler.length > 0, 'handleDownloadTheBusinessApp handler not found in nav')
      assert(navWebHandler.length > 0, 'handleUseBusinessOnWeb handler not found in nav')
      assert(
        /detectClientPlatform\(\)/.test(navDownloadHandler),
        'nav download handler does not call detectClientPlatform()',
      )
      assert(
        /resolveBusinessAppTarget\(/.test(navDownloadHandler),
        'nav download handler does not resolve via resolveBusinessAppTarget',
      )
    },
  ],
  [
    "nav: fires get_the_app_clicked with surface:'organiser', location:'nav' and BOTH actions",
    () => {
      assert(/get_the_app_clicked/.test(navHandler), 'nav handlers missing get_the_app_clicked')
      assert(/surface: 'organiser'/.test(navHandler), "nav handlers missing surface: 'organiser'")
      assert(/location: 'nav'/.test(navHandler), "nav handlers missing location: 'nav'")
      // Without the discriminator, an Android owner who CHOOSES web is
      // indistinguishable from ORCH-1324's forced-web → the fix is unmeasurable.
      assert(/action: 'download'/.test(navDownloadHandler), "nav download handler missing action: 'download'")
      assert(/action: 'use_web'/.test(navWebHandler), "nav web handler missing action: 'use_web'")
    },
  ],
  // ── RE-POINTED by ORCH-1381 ADDENDUM D-B. [TEST-MOD-APPROVED ORCH-1381] ──────
  // WAS: both handlers must call `openBusinessDest(`, and that LOCAL helper must
  // carry `window.open(` + `window.location.assign(`. openBusinessDest no longer
  // exists — it was one of four copy-pasted twins, every one of which carried the
  // double-navigation bug, and D-B replaced them all with lib/open-external.ts.
  // The old assertions pinned WHERE the code lived, so they went red against the
  // CORRECT implementation.
  //
  // The guarantee — neither business action can dead-tap on a blocked popup — is
  // unchanged and still guarded, as the chain it actually is:
  //   Link 1  BOTH handlers route through openExternal(, and the nav hand-rolls
  //           neither window.open( nor .location.assign( (re-inlining the helper is
  //           how this bug reached four surfaces in the first place).
  //   Link 2  openExternal is DRIVEN against a fake Window, not grepped.
  // Fails both ways: delete the fallback in lib/open-external.ts → Link 2 red;
  // drop either handler's delegation or inline window.open( → Link 1 red.
  // ── RETARGETED BY ORCH-1382 [TEST-MOD-APPROVED ORCH-1382] ───────────────────
  // WAS: both handlers must route through openExternal(. ORCH-1382 turns every
  // business destination on this surface into a real <a href> pointing at the
  // ATTRIBUTED OneLink, so openExternal LEGITIMATELY disappears from glass-nav —
  // these greps went red against a CORRECT implementation, pinning WHERE the code
  // lived rather than WHAT it guaranteed.
  //
  // The guarantee — a business action can never dead-tap — is not merely preserved,
  // it is STRONGER: an anchor cannot be popup-blocked at all, and it works inside the
  // in-app webviews where window.open is routinely blocked. So the guard follows the
  // guarantee to where it now lives:
  //   Link 1  both destinations are real anchors carrying href + target + rel.
  //   Link 2  the nav still hand-rolls NEITHER window.open( nor .location.assign(
  //           (re-inlining is exactly how the D-B double-nav bug reached 4 surfaces).
  // Fails both ways: drop an anchor/rel → Link 1 red; inline window.open → Link 2 red.
  [
    'nav: both business actions are real anchors — an anchor cannot be popup-blocked or dead-tap',
    () => {
      // Link 1 — real links to the attributed OneLink / web app.
      assert(
        /<a\s+[^>]*href=\{[^}]*installHref[^}]*\}/.test(nav),
        'nav download action is not a real <a href={…installHref…}> anchor — a <button>+window.open is routinely blocked in the in-app webviews this CTA is opened from (ORCH-1382)',
      )
      assert(
        /<a\s+[^>]*href=\{[^}]*webHref[^}]*\}/.test(nav),
        'nav use-on-web action is not a real <a href={…webHref…}> anchor',
      )
      assert(/target="_blank"/.test(navNoComments), 'nav business anchors lost target="_blank"')
      // ⚠ THE §5.1 TRAP: rel="noopener" on an <a> is REQUIRED and is NOT the
      // ORCH-1381 window.open pathology (that ban is scoped to .open( FEATURE
      // STRINGS). Stripping it "to comply with ORCH-1381" is a security regression.
      assert(
        /rel="noopener/.test(navNoComments),
        'nav business anchors lost rel="noopener" — reverse-tabnabbing. The ORCH-1381 noopener ban applies ONLY to window.open feature strings; on an <a> rel="noopener" is MANDATORY',
      )
      // Link 2 — the D-B bug must not be re-inlined here.
      assert(
        !/window\.open\(/.test(navNoComments),
        'nav inlines window.open( — the inlined twin is exactly what carried the double-navigation bug (ORCH-1381 ADDENDUM D-B)',
      )
      assert(
        !/\.location\.assign\(/.test(navNoComments),
        'nav inlines a .location.assign( fallback — anchors need no popup-block fallback at all',
      )
    },
  ],
  // ── ORCH-1382 — the nav's OneLink must be ATTRIBUTED and never crossed ──────
  [
    'nav: the business OneLink is attributed and never crossed to the consumer domain',
    () => {
      assert(
        /siteAttribution\(\s*'business_nav'\s*\)/.test(navNoComments),
        "nav does not compose siteAttribution('business_nav') — a bare OneLink attributes to the template default and is indistinguishable from organic",
      )
      assert(
        !/go\.usemingla\.com/.test(navNoComments),
        'nav references the CONSUMER branded OneLink domain on a business surface — owners would install the Explorer app (ORCH-1346, H-2)',
      )
      assert(
        !/onelink\.me/.test(navNoComments),
        'nav references a RAW *.onelink.me domain — branded domains only (ORCH-1346)',
      )
    },
  ],
  [
    'nav: organiser CTA renders BOTH actions from the shared copy constants',
    () => {
      // ORCH-1382 — the handlers now TRACK; the anchors navigate. The binding must
      // survive, or the tap analytics are silently dropped.
      assert(
        /onClick=\{handleDownloadTheBusinessApp\}/.test(nav),
        'nav organiser download anchor is not wired to handleDownloadTheBusinessApp — the tap analytics would be silently dropped when the anchor navigates',
      )
      assert(
        /onClick=\{handleUseBusinessOnWeb\}/.test(nav),
        'nav organiser web anchor is not wired to handleUseBusinessOnWeb',
      )
      assert(
        /BUSINESS_APP_CHOICE_COPY\.download/.test(nav),
        'nav download CTA label is not BUSINESS_APP_CHOICE_COPY.download',
      )
      assert(
        /BUSINESS_APP_CHOICE_COPY\.useWeb/.test(nav),
        'nav web CTA label is not BUSINESS_APP_CHOICE_COPY.useWeb',
      )
      // Desktop can install nothing → the install button must be canInstall-gated.
      assert(
        /canInstall/.test(nav),
        'nav does not gate the install button on canInstall — desktop would get a dead button',
      )
    },
  ],
  // ── organiser hero ──────────────────────────────────────────────────────────
  [
    'hero: delegates to the shared decision helper + renders the shared copy',
    () => {
      assert(
        /resolveBusinessAppTarget\(/.test(hero),
        'hero does not call resolveBusinessAppTarget — the decision must come from the ONE module',
      )
      assert(
        /BUSINESS_APP_CHOICE_COPY/.test(hero),
        'hero does not render BUSINESS_APP_CHOICE_COPY (labels/note must not be hand-written)',
      )
      assert(/detectClientPlatform\(\)/.test(hero), 'hero does not call detectClientPlatform()')
    },
  ],
  [
    'hero: the ORCH-1324 collapsed ternary is GONE (it denied Android owners the app)',
    () => {
      assert(
        !/platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/.test(hero),
        'hero still carries the ORCH-1324 collapsed ternary — every Android owner would be sent to the web app instead of the LIVE business Play listing',
      )
    },
  ],
  [
    "hero: fires get_the_app_clicked with surface:'organiser', location:'hero' and BOTH actions",
    () => {
      assert(/get_the_app_clicked/.test(hero), 'hero missing get_the_app_clicked')
      assert(/surface: 'organiser'/.test(hero), "hero missing surface: 'organiser'")
      assert(/location: 'hero'/.test(hero), "hero missing location: 'hero'")
      assert(/action: 'download'/.test(hero), "hero missing action: 'download'")
      assert(/action: 'use_web'/.test(hero), "hero missing action: 'use_web'")
    },
  ],
  // ── RE-POINTED by ORCH-1381 ADDENDUM D-B. [TEST-MOD-APPROVED ORCH-1381] ──────
  // WAS: assert(/window\.location\.assign\(/.test(hero)). §5.3 moved the fallback
  // into lib/open-external.ts, so the grep went red against correct code — it
  // asserted WHERE the fallback lived, not that a blocked popup still navigates.
  // Same two-link chain as the nav case above; both directions covered.
  // ── RETARGETED BY ORCH-1382 [TEST-MOD-APPROVED ORCH-1382] — same reasoning as
  // the nav case above: hero's business destinations are real anchors now, so
  // openExternal legitimately disappears. Angle preserved and strengthened.
  [
    'hero: both business actions are real anchors — an anchor cannot be popup-blocked or dead-tap',
    () => {
      assert(
        /<a\s+[^>]*href=\{[^}]*installHref[^}]*\}/.test(hero),
        'hero download action is not a real <a href={…installHref…}> anchor (ORCH-1382)',
      )
      assert(
        /<a\s+[^>]*href=\{[^}]*webHref[^}]*\}/.test(hero),
        'hero use-on-web action is not a real <a href={…webHref…}> anchor',
      )
      assert(/target="_blank"/.test(heroNoComments), 'hero business anchors lost target="_blank"')
      assert(
        /rel="noopener/.test(heroNoComments),
        'hero business anchors lost rel="noopener" — reverse-tabnabbing. The ORCH-1381 noopener ban applies ONLY to window.open feature strings; on an <a> rel="noopener" is MANDATORY (ORCH-1382 §5.1)',
      )
      assert(
        !/window\.open\(/.test(heroNoComments),
        'hero inlines window.open( — hero.tsx was the 4th call site carrying this exact bug (ORCH-1381 ADDENDUM D-B)',
      )
      assert(
        !/\.location\.assign\(/.test(heroNoComments),
        'hero inlines a .location.assign( fallback — anchors need no popup-block fallback',
      )
    },
  ],
  [
    'hero: the business OneLink is attributed and never crossed to the consumer domain',
    () => {
      assert(
        /siteAttribution\(\s*'business_hero'\s*\)/.test(heroNoComments),
        "hero does not compose siteAttribution('business_hero') — a bare OneLink attributes to the template default",
      )
      assert(
        !/go\.usemingla\.com/.test(heroNoComments),
        'hero references the CONSUMER branded OneLink domain on a business surface (ORCH-1346, H-2)',
      )
      assert(!/onelink\.me/.test(heroNoComments), 'hero references a RAW *.onelink.me domain (ORCH-1346)')
    },
  ],
  [
    'hero: CTA renders BOTH actions + the shared note (NOT the retired iPhone-only subcopy)',
    () => {
      assert(
        /onClick=\{handleDownloadTheBusinessApp\}/.test(hero),
        'hero download anchor is not wired to handleDownloadTheBusinessApp — the tap analytics would be silently dropped',
      )
      assert(
        /onClick=\{handleUseBusinessOnWeb\}/.test(hero),
        'hero web anchor is not wired to handleUseBusinessOnWeb',
      )
      assert(
        /BUSINESS_APP_CHOICE_COPY\.download/.test(hero),
        'hero download CTA label is not BUSINESS_APP_CHOICE_COPY.download',
      )
      assert(
        /BUSINESS_APP_CHOICE_COPY\.useWeb/.test(hero),
        'hero web CTA label is not BUSINESS_APP_CHOICE_COPY.useWeb',
      )
      // The old subcopy was the same falsehood as the email's: it told Android
      // owners the app was iPhone-only. It must NOT come back.
      assert(
        !/On iPhone now — or get started on the web\./.test(hero),
        'hero still renders the retired ORCH-1324 subcopy ("On iPhone now — or get started on the web.") — FALSE since the business Play listing went live (COMMS-0101)',
      )
      assert(
        /BUSINESS_APP_CHOICE_COPY\.moreNote/.test(hero) &&
          /BUSINESS_APP_CHOICE_COPY\.desktopNote/.test(hero),
        'hero does not render both the phone (moreNote) and desktop (desktopNote) notes from the shared copy constant',
      )
    },
  ],
  [
    'hero: gates the install button on canInstall (no dead desktop button)',
    () => {
      assert(
        /canInstall/.test(hero),
        'hero does not gate the install button on canInstall — desktop would get a dead install button',
      )
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1324 business Get-the-app CTA (happy-path)', () => {
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
  console.log(`\nAll ${cases.length} business-getapp happy-path tests passed`)
}
