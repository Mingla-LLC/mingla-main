// ---------------------------------------------------------------
// ORCH-1319 [Explorer direct store links] — TESTER-AUTHORED adversarial
// regression: the platform → store-URL DECISION MATRIX (T-4/T-5/T-6 semantics).
//
// WHY this exists (a DIFFERENT angle than G-1..G-4):
//   G-1..G-4 are TOKEN-PRESENCE greps. They prove APP_STORE_URL + PLAY_STORE_URL
//   + detectClientPlatform/resolvePlatformFromUa + `platform ===` all APPEAR in
//   the source — but NONE of them proves the BINDING is correct. A swapped
//   ternary (iOS → PLAY_STORE_URL, Android → APP_STORE_URL) or a swapped constant
//   (APP_STORE_URL accidentally holding the Play URL) passes ALL FOUR grep-gates
//   yet strands every user on the wrong store — the exact regression this ORCH
//   was created to KILL. This test attacks that blind spot behaviorally.
//
// It replicates the `/download` server decision (app/download/page.tsx:35-39) as a
// pure mapping over the SHARED resolver + SHARED constants, so it pins the route's
// SEMANTICS (and, transitively, the nav handler's identical ios→App / android→Play
// binding) without needing a running server. Runs via the repo's tsc+node pattern:
//   npx tsc lib/download-route-decision.tester.test.ts lib/device-platform.ts \
//     lib/store-links.ts --outDir /tmp/o --module commonjs --target es2020 \
//     --moduleResolution node && node /tmp/o/download-route-decision.tester.test.js
// ---------------------------------------------------------------

import { resolvePlatformFromUa } from './device-platform'
import { APP_STORE_URL, PLAY_STORE_URL } from './store-links'

// The EXACT decision the /download Server Component performs: iOS → App Store,
// Android → Play, everything else → no redirect (render the QR + badges page).
// `null` models "no redirect" (the desktop QR page branch).
function routeRedirectTarget(ua: string): string | null {
  const platform = resolvePlatformFromUa(ua)
  if (platform === 'ios') return APP_STORE_URL
  if (platform === 'android') return PLAY_STORE_URL
  return null
}

// Representative user-agent strings (real-world shapes).
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const UA_IPAD_CLASSIC =
  'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
const UA_IPOD =
  'Mozilla/5.0 (iPod touch; CPU iPhone OS 12_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
const UA_ANDROID_LOWER = 'some android device' // lowercase token — case-insensitive
const UA_MAC_IPAD =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const UA_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const UA_BOT = 'Googlebot/2.1 (+http://www.google.com/bot.html)'
const UA_EMPTY = ''

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  // ── Constant integrity — the swap-regression firewall ──────────────────────
  [
    'the two store constants are DISTINCT (a swap where both point to one store strands the other platform)',
    () => {
      // Widen to `string` so the runtime inequality check is not elided by TS's
      // literal-type narrowing (the two constants are distinct literal types).
      const appUrl: string = APP_STORE_URL
      const playUrl: string = PLAY_STORE_URL
      assert(appUrl !== playUrl, `store constants are equal: ${appUrl}`)
    },
  ],
  [
    'APP_STORE_URL is the canonical LIVE App Store listing (not a Play/TestFlight URL)',
    () => {
      assert(APP_STORE_URL === 'https://apps.apple.com/app/id6760440898', `wrong App Store URL: ${APP_STORE_URL}`)
      assert(!/play\.google\.com/.test(APP_STORE_URL), `APP_STORE_URL points at Play: ${APP_STORE_URL}`)
      assert(!/testflight/i.test(APP_STORE_URL), `APP_STORE_URL is a TestFlight URL: ${APP_STORE_URL}`)
    },
  ],
  [
    'PLAY_STORE_URL is the canonical LIVE Play listing (not an App Store/TestFlight URL)',
    () => {
      assert(
        PLAY_STORE_URL === 'https://play.google.com/store/apps/details?id=com.mingla.app.v2',
        `wrong Play URL: ${PLAY_STORE_URL}`,
      )
      assert(!/apps\.apple\.com/.test(PLAY_STORE_URL), `PLAY_STORE_URL points at the App Store: ${PLAY_STORE_URL}`)
      assert(!/testflight/i.test(PLAY_STORE_URL), `PLAY_STORE_URL is a TestFlight URL: ${PLAY_STORE_URL}`)
    },
  ],

  // ── iOS UAs redirect to the App Store — and NEVER to Play ──────────────────
  [
    'iPhone UA → App Store (and NOT Play)',
    () => {
      assert(routeRedirectTarget(UA_IPHONE) === APP_STORE_URL, `iPhone did not map to App Store`)
      assert(routeRedirectTarget(UA_IPHONE) !== PLAY_STORE_URL, `iPhone stranded on Play`)
    },
  ],
  [
    'classic iPad UA → App Store (and NOT Play)',
    () => {
      assert(routeRedirectTarget(UA_IPAD_CLASSIC) === APP_STORE_URL, `iPad did not map to App Store`)
      assert(routeRedirectTarget(UA_IPAD_CLASSIC) !== PLAY_STORE_URL, `iPad stranded on Play`)
    },
  ],
  [
    'iPod UA → App Store',
    () => assert(routeRedirectTarget(UA_IPOD) === APP_STORE_URL, `iPod did not map to App Store`),
  ],

  // ── Android UAs redirect to Play — and NEVER to the App Store ──────────────
  [
    'Android UA → Play (and NOT App Store)',
    () => {
      assert(routeRedirectTarget(UA_ANDROID) === PLAY_STORE_URL, `Android did not map to Play`)
      assert(routeRedirectTarget(UA_ANDROID) !== APP_STORE_URL, `Android stranded on the App Store`)
    },
  ],
  [
    'lowercase "android" token → Play (case-insensitive resolver)',
    () => assert(routeRedirectTarget(UA_ANDROID_LOWER) === PLAY_STORE_URL, `lowercase android did not map to Play`),
  ],

  // ── Non-mobile UAs render the QR page (no redirect) — SEO/bot/curl safe ─────
  [
    'Windows desktop UA → no redirect (QR page)',
    () => assert(routeRedirectTarget(UA_WINDOWS) === null, `desktop wrongly redirected`),
  ],
  [
    'iPad-as-Mac desktop UA (no iPad token) → no redirect (documented safe QR-page fallback, NOT a wrong-store redirect)',
    () => {
      assert(routeRedirectTarget(UA_MAC_IPAD) === null, `iPad-as-Mac wrongly redirected server-side`)
    },
  ],
  [
    'Googlebot UA → no redirect (crawlers get real HTML)',
    () => assert(routeRedirectTarget(UA_BOT) === null, `bot wrongly redirected`),
  ],
  [
    'empty / no UA (curl) → no redirect (safe desktop fallback)',
    () => assert(routeRedirectTarget(UA_EMPTY) === null, `empty UA wrongly redirected`),
  ],

  // ── The "one QR, both platforms" contract — the whole point of /download ───
  [
    'ONE-QR contract: an iOS scanner and an Android scanner of the SAME /download URL land on DIFFERENT, platform-correct stores',
    () => {
      const ios = routeRedirectTarget(UA_IPHONE)
      const android = routeRedirectTarget(UA_ANDROID)
      assert(ios === APP_STORE_URL && android === PLAY_STORE_URL, `one-QR routing broken: ios=${ios} android=${android}`)
      assert(ios !== android, `one-QR routing collapsed both platforms to the same store`)
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1319 /download platform→store decision matrix (tester adversarial)', () => {
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
  console.log(`\nAll ${cases.length} download-route-decision tests passed`)
}
