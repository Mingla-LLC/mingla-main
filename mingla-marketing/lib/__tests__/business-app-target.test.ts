// ---------------------------------------------------------------
// ORCH-1381 [business-getapp-android-choice] — HAPPY-PATH regression test.
//
// ORCH-1381 — business Android MUST resolve to the LIVE Play listing, never the
// web app. Reverting to the ORCH-1324 `platform === 'ios' ? APP_STORE : WEB`
// ternary silently denies every Android owner the app (the business Play listing
// went live 2026-07-15 — COMMS-0101). This test fails on that revert. Do not
// relax it.
//
// Unlike every other test on these files, this one IMPORTS THE REAL
// `resolveBusinessAppTarget` rather than grepping source — a source grep passes if
// a token merely exists in a comment or a dead branch. This exercises the real
// decision path.
//
// The marketing package has NO jest/vitest runner wired — this is run via the
// repo's tsc+node pattern (mirrors lib/device-platform.test.ts). Run from
// mingla-marketing/:
//   npx tsc lib/__tests__/business-app-target.test.ts --outDir /tmp/o \
//     --module commonjs --target es2020 --moduleResolution node \
//     && node /tmp/o/__tests__/business-app-target.test.js
// (tsc roots the emit at lib/, so the runnable JS lands in /tmp/o/__tests__/.)
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'
import { resolveBusinessAppTarget } from '../business-app-target'
import { linksAttribution } from '../links-src'
import {
  BUSINESS_ONELINK_URL,
  BUSINESS_PLAY_STORE_URL,
  BUSINESS_WEB_URL,
} from '../store-links'

// ORCH-1382 [TEST-MOD-APPROVED ORCH-1382] — resolveBusinessAppTarget now takes a
// REQUIRED attribution argument (SPEC §5.2.4), so every call here gains one.
const ATTR = linksAttribution('youtube', 'business_bio')

// Module SOURCE — for the negative-space cases (T-5, T-6) that must scan the file
// itself, not its runtime values.
const MODULE = path.resolve(process.cwd(), 'lib/business-app-target.ts')
const moduleSrc = fs.readFileSync(MODULE, 'utf8')

const STORE_LINKS = path.resolve(process.cwd(), 'lib/store-links.ts')
const storeLinksSrc = fs.readFileSync(STORE_LINKS, 'utf8')

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  // ── T-1 ⭐ THE REGRESSION GUARD (fails-on-revert) ────────────────────────────
  // RETARGETED BY ORCH-1382 [TEST-MOD-APPROVED ORCH-1382]. The destination changed
  // from the plain Play URL to the attributed business OneLink (SPEC §5.2.4), so
  // pinning BUSINESS_PLAY_STORE_URL would now fail the CORRECT implementation.
  // THE ANGLE IS UNCHANGED AND STILL THE POINT: android must resolve to a real
  // INSTALL destination and must NEVER be sent to the web app. Both the original
  // "android ≠ web" assertion and the ORCH-1381 revert message survive verbatim.
  [
    'T-1: android resolves to the attributed business OneLink — NEVER the web app',
    () => {
      const t = resolveBusinessAppTarget('android', ATTR)
      assert(
        (t.installHref ?? '').startsWith(`${BUSINESS_ONELINK_URL}?`),
        `android installHref is "${t.installHref}", expected the business OneLink "${BUSINESS_ONELINK_URL}?…"`,
      )
      assert(
        t.installStore === 'play',
        `android installStore is "${t.installStore}", expected 'play'`,
      )
      assert(t.canInstall === true, 'android canInstall is not true — the app IS installable on Android')
      // The ORCH-1324 bug, stated directly: Android must never be sent to the web
      // app as its INSTALL target. (The original angle — preserved, not relaxed.)
      assert(
        t.installHref !== BUSINESS_WEB_URL,
        'REVERTED — android installHref is BUSINESS_WEB_URL: every Android owner is denied the app (ORCH-1381)',
      )
      // ORCH-1382 — the install must stay ATTRIBUTED. A bare OneLink falls to the
      // template default and is indistinguishable from organic.
      assert(
        (t.installHref ?? '').includes('pid=bio_youtube') && (t.installHref ?? '').includes('c=business_bio'),
        `android installHref lost its attribution: ${t.installHref}`,
      )
    },
  ],
  // ── T-2 iOS decision ────────────────────────────────────────────────────────
  // RETARGETED BY ORCH-1382 [TEST-MOD-APPROVED ORCH-1382] — same reason as T-1.
  [
    'T-2: ios resolves to the attributed business OneLink',
    () => {
      const t = resolveBusinessAppTarget('ios', ATTR)
      assert(
        (t.installHref ?? '').startsWith(`${BUSINESS_ONELINK_URL}?`),
        `ios installHref is "${t.installHref}", expected the business OneLink "${BUSINESS_ONELINK_URL}?…"`,
      )
      assert(t.installStore === 'app_store', `ios installStore is "${t.installStore}", expected 'app_store'`)
      assert(t.canInstall === true, 'ios canInstall is not true')
      assert(t.installHref !== BUSINESS_WEB_URL, 'REVERTED — ios installHref is BUSINESS_WEB_URL')
    },
  ],
  // ── T-3 desktop decision ────────────────────────────────────────────────────
  [
    "T-3: 'other' (desktop/unknown/bot) has NO install action — web only",
    () => {
      const t = resolveBusinessAppTarget('other', ATTR)
      assert(t.installHref === null, `desktop installHref is "${t.installHref}", expected null (no dead install button)`)
      assert(t.installStore === null, `desktop installStore is "${t.installStore}", expected null`)
      assert(t.canInstall === false, 'desktop canInstall is not false — desktop has nothing to install')
      assert(t.webHref === BUSINESS_WEB_URL, `desktop webHref is "${t.webHref}", expected the business web app`)
    },
  ],
  // ── T-4 the web action is ALWAYS available ──────────────────────────────────
  [
    'T-4: every platform can always use the web (webHref always BUSINESS_WEB_URL)',
    () => {
      for (const platform of ['ios', 'android', 'other'] as const) {
        const t = resolveBusinessAppTarget(platform, ATTR)
        assert(
          t.webHref === BUSINESS_WEB_URL,
          `${platform} webHref is "${t.webHref}", expected "${BUSINESS_WEB_URL}" — the web action must never be lost`,
        )
      }
    },
  ],
  // ── T-5 the RIGHT Android package (consumer is one autocomplete away) ───────
  // RETARGETED BY ORCH-1382 [TEST-MOD-APPROVED ORCH-1382]. android's installHref is
  // now the OneLink, which does not literally contain the package name (AppsFlyer
  // resolves it to `market://…?id=com.sethogieva.minglabusiness` server-side — curl-
  // verified 5/5 at SPEC time). THE ANGLE IS PRESERVED on both halves: the SSOT const
  // must still carry the BUSINESS package (never the consumer one), AND the resolved
  // install target must sit on the business-owned branded domain, which is the
  // property that now determines which app actually installs.
  [
    'T-5: the business listing + OneLink carry the BUSINESS app, not the consumer one',
    () => {
      assert(
        BUSINESS_PLAY_STORE_URL.includes('com.sethogieva.minglabusiness'),
        `BUSINESS_PLAY_STORE_URL does not carry the business package: ${BUSINESS_PLAY_STORE_URL}`,
      )
      assert(
        !BUSINESS_PLAY_STORE_URL.includes('com.mingla.app.v2'),
        'BUSINESS_PLAY_STORE_URL carries the CONSUMER package — owners would install the wrong app',
      )
      const android = resolveBusinessAppTarget('android', ATTR)
      assert(
        (android.installHref ?? '').startsWith('https://biz.usemingla.com/'),
        `android resolves off the business branded domain — it would install the wrong app: ${android.installHref}`,
      )
      assert(
        !(android.installHref ?? '').includes('go.usemingla.com'),
        'android resolves to the CONSUMER branded OneLink domain — owners would install the Explorer app',
      )
    },
  ],
  // ── T-6 no raw / misowned OneLink ───────────────────────────────────────────
  // RATIONALE CORRECTED BY ORCH-1382: the raw *.onelink.me ban is NOT "the OneLink is
  // dead" (it is ALIVE — 5/5 Android-UA curls returned 301 -> market:// at SPEC time,
  // and AppsFlyer reports all 4 apps Active). It is ROUTING POLICY: branded domains
  // only (ORCH-1346). The ban itself is unchanged; only the false "why" is repaired,
  // so the next author does not conclude business OneLinks are unusable.
  [
    'T-6: the decision module references NO raw or consumer-owned OneLink domain',
    () => {
      assert(
        !/minglabiz\.onelink\.me/.test(moduleSrc.replace(/\/\/.*$/gm, '')),
        'business-app-target references the RAW minglabiz.onelink.me domain — business traffic uses the branded biz.usemingla.com (ORCH-1346 routing policy)',
      )
      assert(
        !/go\.usemingla\.com/.test(moduleSrc.replace(/\/\/.*$/gm, '')),
        'business-app-target references go.usemingla.com — consumer-owned (1 domain = 1 template, ORCH-1346)',
      )
    },
  ],
  // ── T-9 the stale "Play still in review" comment is retired ─────────────────
  [
    'T-9: store-links no longer claims the business Play listing is in review',
    () => {
      assert(
        !/still in review/.test(storeLinksSrc),
        'store-links.ts still claims "still in review" — the business Play listing went LIVE 2026-07-15 (COMMS-0101)',
      )
      assert(
        !/no Play listing yet/.test(storeLinksSrc),
        'store-links.ts still claims "no Play listing yet" — the business Play listing is LIVE',
      )
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1381 business app target (happy-path)', () => {
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
  console.log(`\nAll ${cases.length} business-app-target tests passed`)
}
