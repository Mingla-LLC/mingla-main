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
import {
  BUSINESS_APP_STORE_URL,
  BUSINESS_PLAY_STORE_URL,
  BUSINESS_WEB_URL,
} from '../store-links'

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
  [
    'T-1: android resolves to the LIVE business Play listing — NEVER the web app',
    () => {
      const t = resolveBusinessAppTarget('android')
      assert(
        t.installHref === BUSINESS_PLAY_STORE_URL,
        `android installHref is "${t.installHref}", expected the business Play listing "${BUSINESS_PLAY_STORE_URL}"`,
      )
      assert(
        t.installStore === 'play',
        `android installStore is "${t.installStore}", expected 'play'`,
      )
      assert(t.canInstall === true, 'android canInstall is not true — the app IS installable on Android')
      // The ORCH-1324 bug, stated directly: Android must never be sent to the web
      // app as its INSTALL target.
      assert(
        t.installHref !== BUSINESS_WEB_URL,
        'REVERTED — android installHref is BUSINESS_WEB_URL: every Android owner is denied the app (ORCH-1381)',
      )
    },
  ],
  // ── T-2 iOS decision ────────────────────────────────────────────────────────
  [
    'T-2: ios resolves to the business App Store',
    () => {
      const t = resolveBusinessAppTarget('ios')
      assert(
        t.installHref === BUSINESS_APP_STORE_URL,
        `ios installHref is "${t.installHref}", expected "${BUSINESS_APP_STORE_URL}"`,
      )
      assert(t.installStore === 'app_store', `ios installStore is "${t.installStore}", expected 'app_store'`)
      assert(t.canInstall === true, 'ios canInstall is not true')
    },
  ],
  // ── T-3 desktop decision ────────────────────────────────────────────────────
  [
    "T-3: 'other' (desktop/unknown/bot) has NO install action — web only",
    () => {
      const t = resolveBusinessAppTarget('other')
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
        const t = resolveBusinessAppTarget(platform)
        assert(
          t.webHref === BUSINESS_WEB_URL,
          `${platform} webHref is "${t.webHref}", expected "${BUSINESS_WEB_URL}" — the web action must never be lost`,
        )
      }
    },
  ],
  // ── T-5 the RIGHT Android package (consumer is one autocomplete away) ───────
  [
    'T-5: the business Play URL carries the BUSINESS package, not the consumer one',
    () => {
      assert(
        BUSINESS_PLAY_STORE_URL.includes('com.sethogieva.minglabusiness'),
        `BUSINESS_PLAY_STORE_URL does not carry the business package: ${BUSINESS_PLAY_STORE_URL}`,
      )
      assert(
        !BUSINESS_PLAY_STORE_URL.includes('com.mingla.app.v2'),
        'BUSINESS_PLAY_STORE_URL carries the CONSUMER package — owners would install the wrong app',
      )
      const android = resolveBusinessAppTarget('android')
      assert(
        (android.installHref ?? '').includes('com.sethogieva.minglabusiness'),
        'android resolves to a Play URL that is not the business package',
      )
    },
  ],
  // ── T-6 no dead / misowned OneLink ──────────────────────────────────────────
  [
    'T-6: the decision module references NO dead or consumer-owned OneLink',
    () => {
      assert(
        !/minglabiz\.onelink\.me/.test(moduleSrc.replace(/\/\/.*$/gm, '')),
        'business-app-target references minglabiz.onelink.me — DEAD on Android (AppsFlyer Pending, COMMS-0101)',
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
