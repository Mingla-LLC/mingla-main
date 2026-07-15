// ---------------------------------------------------------------
// ORCH-1328 [links-cta-soft-nav-blank-page] — TESTER-ADVERSARIAL test.
//
// Different angle than the happy-path (which proves PRESENCE of the device-aware
// button). This proves the ABSENCE of the soft-nav regression AND the correct
// device binding in links-experience.tsx:
//   (a) NO `from 'next/link'`, NO `<Link` element (no soft-navigation).
//   (b) NO hardcoded store literal (apps.apple.com / play.google.com) — SSOT only.
//   (c) INVERTED BY ORCH-1381 [business-getapp-android-choice]: the Business branch
//       used to be REQUIRED to carry `platform === 'ios' ? BUSINESS_APP_STORE_URL :
//       BUSINESS_WEB_URL`. That was the ORCH-1324 contract and is now THE BUG — it
//       denies every Android owner the business Play listing, live since 2026-07-15
//       (COMMS-0101). The ternary is now asserted ABSENT; the branch must delegate
//       to resolveBusinessAppTarget and offer both actions.
//   (d) the Explorer phone branch is `platform === 'ios' ? APP_STORE_URL :
//       PLAY_STORE_URL` and NOT reversed (Android must land on Play).
//   (e) Desktop-Explorer still reaches the QR: the handler opens `tab.cta.href`
//       (the /download QR page is preserved).
//   (f) RE-POINTED BY ORCH-1381 ADDENDUM D-B: this used to require the TOKENS
//       `window.open(` + `window.location.assign(` in this component. §5.3 moved
//       both into lib/open-external.ts (the ONE owner), so the greps went red
//       against correct code. The no-silent-failure guarantee now guards the real
//       path: the component must DELEGATE to openExternal( and must NOT inline
//       window.open(, and openExternal is DRIVEN against a fake Window to prove a
//       blocked popup still navigates and a successful open does not double-nav.
//   (g) the CTA is keyboard-activatable: a <button type="button"> (native
//       Enter/Space) — NOT a role="button" div.
//
// Comment-stripped (mirrors the ORCH-1328 strict-grep guard) so the informative
// code comments that legitimately NAME the removed <Link>/soft-nav route — and
// window.open itself — never trip the ABSENCE assertions.
//
// Run from mingla-marketing/ (the openExternal import roots the emit at the
// package, so the runnable JS lands under components/marketing/__tests__/):
//   npx tsc components/marketing/__tests__/links-cta-device-aware.tester.test.ts \
//     --outDir /tmp/o --module commonjs --target es2020 --moduleResolution node \
//     --skipLibCheck \
//     && node /tmp/o/components/marketing/__tests__/links-cta-device-aware.tester.test.js
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'

import { openExternal } from '../../../lib/open-external'

const CTA = path.resolve(
  process.cwd(),
  'components/marketing/links-experience.tsx',
)

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const src = stripComments(fs.readFileSync(CTA, 'utf8'))

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

// ── behavioural harness for the delegated open+fallback (case f) ─────────────
// The fake Window models the browser-verified HTML rule (ORCH-1381 ADDENDUM §4.2,
// Chromium): a feature string containing noopener OR noreferrer makes open()
// return null EVEN ON SUCCESS. That null is what made the "popup-blocked fallback"
// fire on every tap. Modelling it is what lets this catch the half-fix that drops
// only 'noopener' and keeps 'noreferrer' (which alone also returns null — C-4).
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
 * The behavioural half of the re-pointed (f) guard: the tap this component
 * delegates cannot fail silently, and cannot double-navigate.
 */
function assertDelegatedTapIsStillGuarded(): void {
  // NO SILENT FAILURE / NO DEAD TAP — what the old assign( grep protected.
  const blocked = driveOpenExternal({ popupBlocked: true })
  assert(
    blocked.assigned.length === 1 && blocked.assigned[0] === DEST,
    `openExternal does not fall back when the popup is genuinely blocked ` +
      `(assigned=${JSON.stringify(blocked.assigned)}) — the tap SILENTLY does nothing. ` +
      `The fallback moved to lib/open-external.ts; the requirement did not.`,
  )
  // NO DOUBLE-NAV — ORCH-1328's own "/links stays mounted" contract.
  const ok = driveOpenExternal({ popupBlocked: false })
  assert(ok.opened === 1, `expected exactly 1 window.open call, got ${ok.opened}`)
  assert(
    ok.assigned.length === 0,
    `DOUBLE NAVIGATION — a successful open ALSO navigated the current tab to ` +
      `"${ok.assigned[0]}" (features="${ok.features}"), so /links does NOT stay mounted — ` +
      `this gate's own invariant, violated by the code it used to pass (ADDENDUM D-B).`,
  )
}

const cases: ReadonlyArray<[string, () => void]> = [
  // ── (a) no soft-navigation ───────────────────────────────────────────────────
  [
    'no next/link import and no <Link> element (the CTA never soft-navigates)',
    () => {
      assert(!/from\s+['"]next\/link['"]/.test(src), 'still imports next/link — the CTA can soft-navigate again')
      // Word-boundary: `<Link[\s/>]` matches the <Link> JSX element but not the
      // unrelated <Linkedin> icon / <LinksTab…> generic types in this file.
      assert(!/<Link[\s/>]/.test(src), 'still renders a next/link <Link> element (soft-nav regressed)')
    },
  ],
  // ── (b) no hardcoded store literal ──────────────────────────────────────────
  [
    'no hardcoded store URL literal (apps.apple.com / play.google.com) — SSOT only',
    () => {
      assert(!/apps\.apple\.com/.test(src), 'hardcodes an apps.apple.com literal (must use the store-links consts)')
      assert(!/play\.google\.com/.test(src), 'hardcodes a play.google.com literal (must use the store-links consts)')
    },
  ],
  // ── (c) INVERTED by ORCH-1381 — the collapsed ternary is now THE BUG ─────────
  [
    'Business branch delegates to resolveBusinessAppTarget and carries NO collapsed ternary',
    () => {
      assert(
        !/platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/.test(src),
        'Business branch still carries the ORCH-1324 collapsed ternary — it sends every Android owner to the web app instead of the LIVE business Play listing (COMMS-0101)',
      )
      assert(
        /resolveBusinessAppTarget\(/.test(src),
        'Business branch does not delegate to resolveBusinessAppTarget — the platform→destination decision lives in exactly ONE module (ORCH-1381)',
      )
      // The business destinations must not be re-derived here at all.
      assert(
        !/BUSINESS_APP_STORE_URL/.test(src) && !/BUSINESS_WEB_URL/.test(src),
        'links-experience re-derives a business destination locally — that triplication is exactly what left 4 surfaces stale when the business Play listing went live',
      )
      // ORCH-1382 — the same rule now applies to the EXPLORER destinations.
      assert(
        /resolveExplorerAppTarget\(/.test(src),
        'the explorer branch does not delegate to resolveExplorerAppTarget — the explorer ternary was duplicated across glass-nav AND here, the identical bug class ORCH-1381 killed for business (ORCH-1382)',
      )
      // Both actions must exist, discriminated for analytics.
      assert(
        /'download'/.test(src) && /'use_web'/.test(src),
        "the Business tab must offer BOTH actions ('download' | 'use_web') — without the discriminator an Android owner who CHOOSES web is indistinguishable from the old forced-web",
      )
      assert(
        /BUSINESS_APP_CHOICE_COPY/.test(src),
        'the Business tab hand-writes its labels/note instead of using BUSINESS_APP_CHOICE_COPY',
      )
    },
  ],
  // ── (d) INVERTED BY ORCH-1382 [TEST-MOD-APPROVED ORCH-1382] ─────────────────
  // WAS: the Explorer phone branch is REQUIRED to carry
  // `platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL`. That was the ORCH-1319
  // contract and is now THE BUG — a plain store URL returns HTTP 200 text/html, so
  // Android renders the Play WEBSITE first (the intermediate-page complaint) and the
  // install arrives ANONYMOUS. Exactly the inversion ORCH-1381 applied to business.
  // The ternary is now asserted ABSENT; the branch must delegate + attribute.
  [
    'Explorer branch carries NO raw store ternary and resolves the ATTRIBUTED OneLink',
    () => {
      assert(
        !/platform === 'ios' \? APP_STORE_URL : PLAY_STORE_URL/.test(src),
        'Explorer phone branch still carries the raw store ternary — a plain store URL renders the Play WEBSITE first on Android and drops attribution (ORCH-1382)',
      )
      assert(
        !/platform === 'ios' \? PLAY_STORE_URL : APP_STORE_URL/.test(src),
        'Explorer phone branch carries a REVERSED raw store ternary (iOS → Play, Android → App Store)',
      )
      assert(
        !/\bAPP_STORE_URL\b/.test(src) && !/\bPLAY_STORE_URL\b/.test(src),
        'Explorer branch still references a raw store const — the destination must come from resolveExplorerAppTarget (ORCH-1382)',
      )
      // ⭐ NEVER CROSSED (H-2) — the highest-damage bug available on this surface.
      assert(
        !/biz\.usemingla\.com/.test(src),
        'links-experience hardcodes the BUSINESS branded domain — never crossed, and never a literal (the base lives in store-links.ts)',
      )
      assert(
        !/onelink\.me/.test(src),
        'links-experience references a RAW *.onelink.me domain — branded domains only (ORCH-1346)',
      )
    },
  ],
  // ── (e) desktop-Explorer preserves the QR ───────────────────────────────────
  [
    'desktop-Explorer still opens the /download QR page (openExternal(tab.cta.href))',
    () => {
      assert(
        /openExternal\(tab\.cta\.href\)/.test(src),
        'the desktop/other Explorer branch no longer opens tab.cta.href (the /download QR page is lost)',
      )
      // ORCH-1382 — openExternal survives for EXACTLY this one non-store destination.
      // Deleting the module because its last store caller moved is how the D-B
      // double-nav bug comes back (COMMS-0101 records the `if (!win)` idiom as still
      // unswept in mingla-admin/ + the RN webviews).
      assert(
        /openExternal\(/.test(src),
        'openExternal is gone entirely — it must survive for the desktop /download QR page (its ONE remaining call site)',
      )
    },
  ],
  // ── (f) the tap is delegated, and the delegate cannot fail silently ─────────
  // RE-POINTED by ORCH-1381 ADDENDUM D-B. [TEST-MOD-APPROVED ORCH-1381]
  // WAS: assert(/window\.open\(/.test(src)) + assert(/window\.location\.assign\(/.test(src)).
  // §5.3 relocated both tokens into lib/open-external.ts, so these greps went red
  // against a CORRECT implementation — they pinned WHERE the code lived, not WHAT
  // it did. The no-silent-failure guarantee is unchanged and still guarded, now
  // where the behaviour actually lives:
  //   Link 1  this component delegates and does NOT hand-roll the open (an inlined
  //           window.open( is precisely the shipped bug — banned, matching this
  //           ORCH's own CI gate orch-1328-links-cta-opens-store-clientside.mjs).
  //   Link 2  openExternal is DRIVEN against a fake Window, not grepped.
  // Fails both ways: delete the fallback in lib/open-external.ts → Link 2 red;
  // inline window.open( back here → Link 1 red.
  [
    'the tap is delegated to openExternal, which cannot dead-tap or double-navigate',
    () => {
      // Link 1 — delegation only; no inlined open/fallback on this surface.
      assert(
        /openExternal\(/.test(src),
        'no openExternal( — the store is not opened on the gesture through the ONE owner ' +
          'of the open+popup-block decision (lib/open-external)',
      )
      assert(
        !/window\.open\(/.test(src),
        'inlines window.open( instead of delegating to openExternal( — the inlined pattern ' +
          'carried a noopener/noreferrer feature string and double-navigated on every tap ' +
          '(ORCH-1381 ADDENDUM D-B)',
      )
      assert(
        !/\.location\.assign\(/.test(src),
        'inlines a .location.assign( fallback instead of delegating to openExternal(',
      )
      // Link 2 — the delegated behaviour itself.
      assertDelegatedTapIsStillGuarded()
    },
  ],
  // ── (g) RETARGETED BY ORCH-1382 [TEST-MOD-APPROVED ORCH-1382] ───────────────
  // WAS: the CTA must be a native <button type="button">. The store/web CTAs are now
  // real <a href> anchors — which are ALSO natively keyboard-activatable, and unlike
  // a <button> they additionally survive in-app webviews and restore long-press /
  // middle-click / copy-link / screen-reader link semantics. The ANGLE is unchanged:
  // every CTA must be a real, natively-activatable control — never a div.
  [
    'every CTA is a real, natively keyboard-activatable control (never a div)',
    () => {
      // The store/web CTAs: real anchors with real hrefs.
      assert(
        /<a\s+[^>]*href=\{[^}]*(?:installHref|webHref)[^}]*\}/.test(src),
        'the store/web CTA is not a real <a href={…}> anchor',
      )
      // The desktop QR CTA: still a real button (it opens a page, not a store).
      assert(/<button/.test(src), 'the desktop QR CTA is not a <button>')
      assert(/type="button"/.test(src), 'the desktop QR CTA lacks type="button"')
      // Neither may be faked.
      assert(!/role="button"/.test(src), 'a role="button" (non-native) control is used — must be a real <button> or <a>')
      assert(
        !/<div[^>]*onClick=\{\(\) => onCta/.test(src),
        'a CTA is a <div onClick> — dead for keyboard users, and invisible to assistive tech (Constitution #1)',
      )
      // ⚠ THE §5.1 TRAP — rel must NOT have been stripped while "complying" with the
      // ORCH-1381 noopener ban (which is scoped to window.open FEATURE STRINGS).
      assert(
        /rel="noopener/.test(src),
        'the CTA anchors lost rel="noopener" — reverse-tabnabbing regression. On an <a>, rel="noopener" is MANDATORY; the ORCH-1381 ban applies only to window.open feature strings',
      )
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1328 links CTA opens the store client-side (adversarial)', () => {
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
  console.log(`\nAll ${cases.length} links-cta-device-aware adversarial tests passed`)
}
