// ---------------------------------------------------------------
// ORCH-1381 [business-getapp-android-choice] — TESTER ADVERSARIAL regression test.
//
// DIFFERENT ANGLE FROM T-1 (business-app-target.test.ts), deliberately.
// T-1 is the happy path: it pins `resolveBusinessAppTarget('android', ATTR).installHref`
// to the one correct literal. That catches the ONE revert we already know about.
// This file attacks the decision helper as a STATE MACHINE instead, and asserts the
// invariants that must hold for EVERY input — including inputs the type system
// promises can never arrive, which is exactly the promise that breaks at runtime
// when a caller passes a value read from a header, a query string, or a bad cast.
//
// The angles here (none of which T-1 covers):
//   A-1 INVARIANT  — a choice with two actions that both go to the SAME place is a
//                    FAKE choice. Any collapse (android→web, ios→web, a future
//                    ios→web "simplification") is caught, not just the one literal.
//   A-2 COHERENCE  — canInstall / installHref / installStore must agree or the UI
//                    renders a DEAD install button (Constitution #1). Every surface
//                    branches on `canInstall` but then dereferences `installHref`.
//   A-3 FAIL-CLOSED— malformed / cased / whitespace / null platform input must fall
//                    to web-only. A bad platform must NEVER manufacture an install
//                    action pointing at the wrong place.
//   A-4 NO CROSS-APP CONTAMINATION — by IDENTITY against the consumer constants,
//                    not by substring. Shipping owners the consumer Explorer app is
//                    the single most damaging bug available here.
//   A-5 PURITY     — no shared mutable state across calls; call order cannot poison
//                    a later answer.
//
// Run from mingla-marketing/ (repo tsc+node pattern; the package has no jest):
//   npx tsc lib/__tests__/business-app-target.tester.test.ts --outDir /tmp/o \
//     --module commonjs --target es2020 --moduleResolution node \
//     && node /tmp/o/__tests__/business-app-target.tester.test.js
//
// APPEND-ONLY: this file is a NEW tester artifact. Do not weaken or delete it.
// ---------------------------------------------------------------

import { resolveBusinessAppTarget } from '../business-app-target'
import type { Platform } from '../device-platform'
import { linksAttribution } from '../links-src'
import {
  APP_STORE_URL,
  BUSINESS_APP_STORE_URL,
  BUSINESS_ONELINK_URL,
  BUSINESS_PLAY_STORE_URL,
  BUSINESS_WEB_URL,
  EXPLORER_ONELINK_URL,
  PLAY_STORE_URL,
} from '../store-links'

// ORCH-1382 [TEST-MOD-APPROVED ORCH-1382] — resolveBusinessAppTarget now takes a
// REQUIRED attribution argument (SPEC §5.2.4), so every call below gains one.
const ATTR = linksAttribution('youtube', 'business_bio')

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const REAL_PLATFORMS: readonly Platform[] = ['ios', 'android', 'other']
const INSTALLABLE: readonly Platform[] = ['ios', 'android']

const cases: ReadonlyArray<[string, () => void]> = [
  // ── A-1 ⭐ THE FAKE-CHOICE INVARIANT ────────────────────────────────────────
  // ORCH-1381 ships TWO actions. If both resolve to the same destination the UI
  // still renders two buttons — the owner sees a choice that is a lie. T-1 pins a
  // literal; this pins the RELATIONSHIP, so it also catches reverts T-1 never
  // enumerated (e.g. a future "just send everyone to web" simplification on iOS).
  [
    'A-1: wherever an install action exists, it must NOT lead to the web app (no fake choice)',
    () => {
      for (const platform of INSTALLABLE) {
        const t = resolveBusinessAppTarget(platform, ATTR)
        assert(
          t.canInstall === true,
          `${platform} is an installable platform but canInstall is ${String(t.canInstall)}`,
        )
        assert(
          t.installHref !== t.webHref,
          `FAKE CHOICE — ${platform}: "Download the app" and "Use on web" both resolve to "${t.webHref}". Two buttons, one destination: the owner is offered a choice that does not exist (ORCH-1381).`,
        )
        assert(
          t.installHref !== BUSINESS_WEB_URL,
          `REVERTED — ${platform} installHref is BUSINESS_WEB_URL; the ORCH-1324 collapsed ternary is back and ${platform} owners are denied the app.`,
        )
      }
    },
  ],

  // ── A-2 STATE COHERENCE — the dead-button guard (Constitution #1) ───────────
  // Every surface renders `canInstall && installHref !== null ? <a href={installHref}>`.
  // If these three ever disagree, a surface renders an install control that points
  // nowhere (or hides one that should exist). Assert them as ONE atomic fact.
  [
    'A-2: canInstall, installHref and installStore can never disagree (no dead install button)',
    () => {
      for (const platform of REAL_PLATFORMS) {
        const t = resolveBusinessAppTarget(platform, ATTR)
        const hasHref = t.installHref !== null
        const hasStore = t.installStore !== null
        assert(
          t.canInstall === hasHref,
          `${platform}: canInstall=${t.canInstall} but installHref=${String(t.installHref)} — a surface would render a dead install button, or hide a live one (Constitution #1).`,
        )
        assert(
          t.canInstall === hasStore,
          `${platform}: canInstall=${t.canInstall} but installStore=${String(t.installStore)} — analytics would label an action that does not exist, or drop one that does.`,
        )
        // An install href, if present, must be a real absolute store URL — never
        // an empty string / "null" / "#", each of which renders a dead anchor.
        if (hasHref) {
          assert(
            typeof t.installHref === 'string' && /^https:\/\/\S+$/.test(t.installHref as string),
            `${platform}: installHref "${String(t.installHref)}" is not an absolute https URL — dead tap.`,
          )
        }
        // The web action is the one thing EVERY device must always have.
        assert(
          typeof t.webHref === 'string' && /^https:\/\/\S+$/.test(t.webHref),
          `${platform}: webHref "${t.webHref}" is not an absolute https URL — the always-available action is broken.`,
        )
      }
    },
  ],

  // ── A-3 FAIL-CLOSED on malformed input ─────────────────────────────────────
  // `Platform` is a TS union, but this helper is fed by resolvePlatformFromUa()
  // (a raw request header) on the server and detectClientPlatform() on the client.
  // A cast, a casing slip, or a stray space must degrade to web-only — NEVER to a
  // wrong install target. Desktop/bot/unknown already relies on this path.
  [
    'A-3: malformed / cased / empty / nullish platform input fails CLOSED to web-only',
    () => {
      const garbage = [
        'ANDROID',
        'Android',
        'iOS',
        'IOS',
        ' android',
        'android ',
        '',
        ' ',
        'windows',
        'linux',
        'Googlebot',
        null,
        undefined,
        0,
        {},
        [],
      ]
      for (const bad of garbage) {
        const t = resolveBusinessAppTarget(bad as unknown as Platform, ATTR)
        assert(
          t.canInstall === false,
          `platform ${JSON.stringify(bad)} produced canInstall=true — an unrecognised device was offered an install action.`,
        )
        assert(
          t.installHref === null,
          `platform ${JSON.stringify(bad)} produced installHref="${String(t.installHref)}" — an unrecognised device was pointed at a store.`,
        )
        assert(
          t.installStore === null,
          `platform ${JSON.stringify(bad)} produced installStore="${String(t.installStore)}".`,
        )
        assert(
          t.webHref === BUSINESS_WEB_URL,
          `platform ${JSON.stringify(bad)} lost the web action (webHref="${t.webHref}") — it must never fail OPEN.`,
        )
      }
    },
  ],

  // ── A-4 NO CROSS-APP CONTAMINATION (by identity, not substring) ─────────────
  // Both apps live at play.google.com/store/apps/details?id=… and apps.apple.com/…
  // The consumer listing is one autocomplete away. T-5 greps the package string;
  // this compares the resolved value against the CONSUMER constants themselves, so
  // it still fires if someone repoints BUSINESS_PLAY_STORE_URL at the consumer app.
  [
    'A-4: a business surface can never resolve to a CONSUMER store listing',
    () => {
      for (const platform of INSTALLABLE) {
        const { installHref } = resolveBusinessAppTarget(platform, ATTR)
        assert(
          installHref !== PLAY_STORE_URL,
          `${platform}: business install target IS the consumer Play listing (${PLAY_STORE_URL}) — owners would install the Explorer app.`,
        )
        assert(
          installHref !== APP_STORE_URL,
          `${platform}: business install target IS the consumer App Store listing (${APP_STORE_URL}) — owners would install the Explorer app.`,
        )
      }
      // And the two business constants must not be swapped with each other.
      // ORCH-1382 — both phones now resolve to the attributed BUSINESS OneLink,
      // which 301s per device. The angle is unchanged: each must land on the
      // BUSINESS-owned base, never a consumer one.
      for (const platform of INSTALLABLE) {
        assert(
          (resolveBusinessAppTarget(platform, ATTR).installHref ?? '').startsWith(`${BUSINESS_ONELINK_URL}?`),
          `${platform} resolves to something other than the business OneLink: ${resolveBusinessAppTarget(platform, ATTR).installHref}`,
        )
      }
      // Widened to `string` so the literal-type checker does not flag the
      // comparison as "no overlap" (mirrors the ORCH-1329 email tester pattern).
      // The check must survive a future edit that repoints either constant.
      const bizPlay: string = BUSINESS_PLAY_STORE_URL
      const bizStore: string = BUSINESS_APP_STORE_URL
      const consumerPlay: string = PLAY_STORE_URL
      const consumerStore: string = APP_STORE_URL
      assert(
        bizPlay !== consumerPlay && bizStore !== consumerStore,
        'a BUSINESS store constant is byte-identical to a CONSUMER one — the SSOT has been cross-wired.',
      )
    },
  ],

  // ── A-5 PURITY — call order must not poison a later answer ──────────────────
  // The helper is imported by a Server Component (one module instance serving many
  // concurrent requests). Any memoisation or shared mutable state would leak one
  // visitor's platform into the next visitor's page.
  [
    'A-5: the decision is pure — call order and repetition cannot change an answer',
    () => {
      const androidFirst = resolveBusinessAppTarget('android', ATTR)
      resolveBusinessAppTarget('ios', ATTR)
      resolveBusinessAppTarget('other', ATTR)
      resolveBusinessAppTarget('ios', ATTR)
      const androidAgain = resolveBusinessAppTarget('android', ATTR)
      assert(
        androidFirst.installHref === androidAgain.installHref &&
          androidFirst.installStore === androidAgain.installStore &&
          androidFirst.canInstall === androidAgain.canInstall &&
          androidFirst.webHref === androidAgain.webHref,
        `IMPURE — android resolved differently after interleaved calls: ${JSON.stringify(androidFirst)} vs ${JSON.stringify(androidAgain)}. On the server this leaks one request's device into another's HTML.`,
      )
      // Returned objects must not be a shared singleton a caller could mutate.
      const a = resolveBusinessAppTarget('android', ATTR)
      const b = resolveBusinessAppTarget('android', ATTR)
      assert(a !== b, 'resolveBusinessAppTarget returns a SHARED object — one caller mutating it corrupts every other surface.')
    },
  ],

  // ── A-6 ⭐ NEW (ORCH-1382) — CROSS-APP ONELINK CONTAMINATION ────────────────
  // A NEW vector that did not exist before ORCH-1382. Until now the business install
  // target was a plain Play/App Store URL and the only way to ship owners the wrong
  // app was to paste the wrong package id — visible, and already covered by A-4.
  // Now BOTH apps install through near-identical branded OneLinks that differ by a
  // few characters (`go.usemingla.com/w36m` vs `biz.usemingla.com/ZSCW`), declared
  // four lines apart in the same file. Cross them and NOTHING looks broken: the CTA
  // works, the link 301s, a store opens — it is simply the WRONG APP, and both apps'
  // attribution is silently poisoned. No error, no crash, nothing to eyeball.
  //
  // A-4 compares against the consumer STORE constants. This compares against the
  // consumer ONELINK — the thing that now actually decides which app installs.
  [
    'A-6: a business surface can NEVER resolve to the CONSUMER OneLink (cross-app contamination)',
    () => {
      for (const platform of REAL_PLATFORMS) {
        const { installHref } = resolveBusinessAppTarget(platform, ATTR)
        const href = installHref ?? ''
        assert(
          !href.includes('go.usemingla.com'),
          `${platform}: the business install target carries the CONSUMER branded OneLink domain (go.usemingla.com) — every business owner who taps "Get the app" installs the consumer Explorer app instead, and BOTH apps' attribution is corrupted: ${href}`,
        )
        assert(
          !href.startsWith(EXPLORER_ONELINK_URL),
          `${platform}: the business install target IS the Explorer OneLink: ${href}`,
        )
        assert(
          !href.includes('w36m'),
          `${platform}: the business install target carries the CONSUMER OneLink template id (w36m) — one branded domain = one template (ORCH-1346), so this resolves to the consumer app: ${href}`,
        )
        // Raw OneLink domains are banned on routing policy (branded only) — NOT
        // because they are dead. Both OneLinks were curl-proven ALIVE (301 →
        // market://) 5/5 at ORCH-1382 SPEC time.
        assert(
          !/onelink\.me/.test(href),
          `${platform}: the business install target uses a RAW *.onelink.me domain — branded domains only (ORCH-1346): ${href}`,
        )
      }
      // And the two branded bases must never be byte-identical.
      const explorerBase: string = EXPLORER_ONELINK_URL
      const businessBase: string = BUSINESS_ONELINK_URL
      assert(
        explorerBase !== businessBase,
        'the EXPLORER and BUSINESS OneLink bases are byte-identical — the SSOT has been cross-wired and one app is unreachable.',
      )
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1381 business app target (tester adversarial)', () => {
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
  console.log(`\nAll ${cases.length} ORCH-1381 tester adversarial tests passed`)
}
